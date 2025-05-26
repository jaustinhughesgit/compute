process.env.PATH = process.env.PATH + ":/opt/gm/bin:/opt/gm/lib:/opt/gs/bin:/opt/gs/lib";

var express = require('express');
const serverless = require('serverless-http');
const AWS = require('aws-sdk');
const app = express();
const cookieParser = require('cookie-parser');
const path = require('path');
const session = require('express-session');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const util = require('util');
const child_process = require('child_process')
const exec = util.promisify(child_process.exec);
const axios = require('axios');
const { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand } = require("@aws-sdk/client-scheduler");
const moment = require('moment-timezone')
const math = require('mathjs');

const boundAxios = {
    constructor: axios.constructor.bind(axios),
    request: axios.request.bind(axios),
    _request: axios._request.bind(axios),
    getUri: axios.getUri.bind(axios),
    delete: axios.delete.bind(axios),
    get: axios.get.bind(axios),
    head: axios.head.bind(axios),
    options: axios.options.bind(axios),
    post: axios.post.bind(axios),
    postForm: axios.postForm.bind(axios),
    put: axios.put.bind(axios),
    putForm: axios.putForm.bind(axios),
    patch: axios.patch.bind(axios),
    patchForm: axios.patchForm.bind(axios),
    create: axios.create.bind(axios),
    isCancel: axios.isCancel.bind(axios),
    toFormData: axios.toFormData.bind(axios),
    all: axios.all.bind(axios),
    spread: axios.spread.bind(axios),
    isAxiosError: axios.isAxiosError.bind(axios),
    mergeConfig: axios.mergeConfig.bind(axios),

    defaults: axios.defaults,
    interceptors: axios.interceptors,
    Axios: axios.Axios,
    CanceledError: axios.CanceledError,
    CancelToken: axios.CancelToken,
    VERSION: axios.VERSION,
    AxiosError: axios.AxiosError,
    Cancel: axios.Cancel,
    AxiosHeaders: axios.AxiosHeaders,
    formToJSON: axios.formToJSON,
    getAdapter: axios.getAdapter,
    HttpStatusCode: axios.HttpStatusCode
}

const OpenAI = require("openai");
const openai = new OpenAI();
const EMB_MODEL = 'text-embedding-3-large';

const Anthropic = require('@anthropic-ai/sdk');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true, cookie: { secure: true } }));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(cookieParser());
AWS.config.update({ region: 'us-east-1' });
dynamodbLL = new AWS.DynamoDB();
dynamodb = new AWS.DynamoDB.DocumentClient();
SM = new AWS.SecretsManager();
s3 = new AWS.S3();
ses = new AWS.SES();

var cookiesRouter;
var controllerRouter = require('./routes/controller')(dynamodb, dynamodbLL, uuidv4);
var indexRouter = require('./routes/index');
var indexingRouter = require('./routes/indexing');
const embeddingsRouter = require('./routes/embeddings');
const pineconeRouter = require('./routes/pinecone');
const schemaRouter = require('./routes/schema');

let { setupRouter, getHead, convertToJSON, manageCookie, getSub, createVerified, incrementCounterAndGetNewValue, getWord, createWord, addVersion, updateEntity, getEntity, verifyThis } = require('./routes/cookies')

//console.log("")
app.use('/embeddings', embeddingsRouter);
app.use('/pinecone', pineconeRouter);
app.use('/schema', schemaRouter);
app.use('/controller', controllerRouter);
app.use('/indexing', indexingRouter);

app.use('/', indexRouter);

function normaliseEmbedding(e) {
    if (Array.isArray(e)) return e;
    if (e && e.data && e.dims) {
        const n = e.dims[0];
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = e.data[i];
        return out;
    }
    throw new Error('Bad embedding format');
}


async function ensureTable(tableName) {
    try {
        await dynamodbLL.describeTable({ TableName: tableName }).promise();
    } catch (err) {
        if (err.code !== 'ResourceNotFoundException') throw err;

        await dynamodbLL.createTable({
            TableName: tableName,
            AttributeDefinitions: [
                { AttributeName: 'root', AttributeType: 'S' },
                { AttributeName: 'id', AttributeType: 'N' }
            ],
            KeySchema: [
                { AttributeName: 'root', KeyType: 'HASH' },
                { AttributeName: 'id', KeyType: 'RANGE' }
            ],
            BillingMode: 'PAY_PER_REQUEST'
        }).promise();

        await dynamodbLL.waitFor('tableExists', { TableName: tableName }).promise();
    }
}

const nextId = () => Date.now();

app.post('/api/ingest', async (req, res) => {
    try {
        let { category, root, paths } = req.body;
        if (!category || !root || !Array.isArray(paths) || paths.length === 0) {
            return res.status(400).json({ error: 'bad payload' });
        }

        if (typeof paths[0] === 'string') {
            const { data } = await openai.embeddings.create({
                model: EMB_MODEL,
                input: paths
            });

            paths = paths.map((p, i) => ({ p, emb: data[i].embedding }));
        }

        const tableName = `i_${category}`;
        await ensureTable(tableName);

        const item = { root, id: nextId() };
        paths.forEach(({ p, emb }, idx) => {
            item[`path${idx + 1}`] = p;
            item[`emb${idx + 1}`] = JSON.stringify(normaliseEmbedding(emb));
        });

        await dynamodb.put({ TableName: tableName, Item: item }).promise();
        res.json({ ok: true, wrote: paths.length });
    } catch (err) {
        console.error('ingest error:', err);
        res.status(502).json({ error: err.message || 'embedding‑service‑unavailable' });
    }
});

app.use(async (req, res, next) => {

    if (!cookiesRouter) {
        try {
            const privateKey = await getPrivateKey();
            cookiesRouter = setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic);
            app.use('/:type(cookies|url)*', function (req, res, next) {
                req.type = req.params.type;
                next('route');
            }, cookiesRouter);
            next();
        } catch (error) {
            console.error("Failed to retrieve private key:", error);
            res.status(500).send("Server Error");
        }
    } else {
        next();
    }
});

function isSubset(jsonA, jsonB) {
    if (typeof jsonA !== 'object' || typeof jsonB !== 'object') {
        return false;
    }

    for (let key in jsonA) {
        if (jsonA.hasOwnProperty(key)) {
            if (!jsonB.hasOwnProperty(key)) {
                return false;
            }

            if (typeof jsonA[key] === 'object' && typeof jsonB[key] === 'object') {
                if (!isSubset(jsonA[key], jsonB[key])) {
                    return false;
                }
            } else {
                if (jsonA[key] !== jsonB[key]) {
                    return false;
                }
            }
        }
    }

    return true;
}

async function isValid(req, res, data) {
    //console.log("isValid", req)

    //console.log("req.path::", req.path)


    let originalHost = req.body.headers["X-Original-Host"];
    //console.log("originalHost", originalHost)
    let splitOriginalHost = originalHost.split("1var.com")[1]
    //console.log("splitOriginalHost", splitOriginalHost)
    let reqPath = splitOriginalHost.split("?")[0]
    reqPath = reqPath.replace("/cookies/runEntity", "").replace("/auth/", "").replace("/blocks/", "").replace("/cookies/runEntity/", "").replace("/", "").replace("api", "").replace("/", "")
    //console.log("reqPath", reqPath)
    req.dynPath = reqPath


    let sub = await getSub(req.dynPath, "su", dynamodb)
    //console.log("sub", sub)
    let params = { TableName: 'access', IndexName: 'eIndex', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: { ':e': sub.Items[0].e.toString() } }
    //console.log("params", params)
    let accessItem = await dynamodb.query(params).promise()
    //console.log("accessItem", accessItem)
    let isDataPresent = false
    if (accessItem.Items.length > 0) {
        //console.log("accessItem.Items[0].va", accessItem.Items[0].va)
        isDataPresent = isSubset(accessItem.Items[0].va, data)
    }
    //console.log("isDataPresent", isDataPresent)
    if (isDataPresent) {
        let xAccessToken = req.body.headers["X-accessToken"]
        let cookie = await manageCookie({}, xAccessToken, res, dynamodb, uuidv4)
        const vi = await incrementCounterAndGetNewValue('viCounter', dynamodb);
        const ttlDurationInSeconds = 90000;
        const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
        await createVerified(vi.toString(), cookie.gi.toString(), "0", sub.Items[0].e.toString(), accessItem.Items[0].ai, "0", ex, true, 0, 0)
    }
    //console.log("validating data", data)
    return data
}

app.all("/0001", async (req, res, next) => {

});

app.all("/2356", async (req, res, next) => {

});

app.all("/eb1", async (req, res, next) => {

})

app.all('/blocks/*',
    async (req, res, next) => {
        req.lib = {}
        req.lib.modules = {};
        req.lib.middlewareCache = []
        req.lib.isMiddlewareInitialized = false;
        req.lib.whileLimit = 10;
        req.lib.root = {}
        req.lib.root.context = {}
        req.lib.root.context.session = session
        res.originalJson = res.json;


        res.json = async function (data) {
            if (await isValid(req, res, data)) {
                res.originalJson.call(this, data);
            } else {
                res.originalJson.call(this, {});
            }
        };
        next();
    },
    async (req, res, next) => {
        req.blocks = true;
        let blocksData = await initializeMiddleware(req, res, next);

        if (req._headerSent == false) {
            res.json({ "data": blocksData });
        }
    }
);

app.all('/auth/*',
    async (req, res, next) => {
        //console.log("running middleware")
        await runApp(req, res, next)
    }
)

async function runApp(req, res, next) {
    console.log("runApp-runApp")
    try {
        req.lib = {};
        req.lib.modules = {};
        req.lib.middlewareCache = [];
        req.lib.isMiddlewareInitialized = false;
        req.lib.whileLimit = 100;
        req.lib.root = {};
        req.lib.root.context = {};
        req.lib.root.context.session = session;
        const response = { ok: true, response: { status: 'authenticated', file: '' } };

        console.log("req.body+>>", req.body)
        console.log("res+>>", res)



        if (req.path == "/") {
            req.dynPath = "/cookies/runEntity"
        } else {
            req.dynPath = req.path
        }



        console.log("req.path000", req.dynPath)
        console.log("req.lib.isMiddlewareInitialized", req.lib.isMiddlewareInitialized)
        if (!req.lib.isMiddlewareInitialized && (req.dynPath.startsWith('/auth') || req.dynPath.startsWith('/cookies/'))) {
            //console.log("runApp1")
            req.blocks = false;
            //console.log("AAAAAA11111")
            req.lib.middlewareCache = await initializeMiddleware(req, res, next);
            req.lib.isMiddlewareInitialized = true;
        }

        //console.log("req.lib.middlewareCache", req.lib.middlewareCache)
        //console.log("req.lib", req.lib)
        if (req.lib.middlewareCache.length === 0) {
            if (req._headerSent == false) {
                res.send("no access");
            }
            return
        }

        if (req.lib.middlewareCache.length > 0) {
            const runMiddleware = async index => {
                if (index >= req.lib.middlewareCache.length) return;

                const maybe = await req.lib.middlewareCache[index](
                    req,
                    res,
                    () => runMiddleware(index + 1) 
                );

               
                if (
                    maybe &&
                    typeof maybe === "object" &&
                    maybe._isFunction !== undefined &&
                    maybe.chainParams !== undefined
                ) {
                    return maybe; 
                }

              
                return maybe;
            };
            const bubble = await runMiddleware(0); 
            if (bubble) {                         
                req.body.params = bubble.chainParams;  
                return bubble;                       
            }
        }


    } catch (error) {
        next(error);
    }
}

async function getPrivateKey() {
    const secretName = "public/1var/s3";
    try {
        const data = await SM.getSecretValue({ SecretId: secretName }).promise();
        const secret = JSON.parse(data.SecretString);
        let pKey = JSON.stringify(secret.privateKey).replace(/###/g, "\n").replace('"', '').replace('"', '');
        return pKey
    } catch (error) {
        //console.error("Error fetching secret:", error);
        throw error;
    }
}

async function retrieveAndParseJSON(fileName, isPublic, getSub, getWord) {



    let fileLocation = "private"
    if (isPublic == "true" || isPublic == true) {
        fileLocation = "public"
    }
    const params = { Bucket: fileLocation + '.1var.com', Key: fileName };
    const data = await s3.getObject(params).promise();
    if (data.ContentType == "application/json") {
        let s3JSON = await JSON.parse(data.Body.toString());

        const promises = s3JSON.published.blocks.map(async (obj, index) => {
            let subRes = await getSub(obj.entity, "su", dynamodb)
            let name = await getWord(subRes.Items[0].a, dynamodb)
            s3JSON.published.name = name.Items[0].r
            s3JSON.published.entity = obj.entity
            let loc = subRes.Items[0].z
            let fileLoc = "private"
            if (isPublic == "true" || isPublic == true) {
                fileLoc = "public"
            }
            s3JSON.published.blocks[index].privacy = fileLoc
            return s3JSON.published
        })
        let results22 = await Promise.all(promises);
        if (results22.length > 0) {
            return results22[0];
        } else {
            let s3JSON2 = await JSON.parse(data.Body.toString());
            let subRes = await getSub(fileName, "su", dynamodb)
            let name = await getWord(subRes.Items[0].a, dynamodb)
            s3JSON2.published.name = name.Items[0].r
            s3JSON2.published.entity = fileName
            return s3JSON2.published
        }
    } else {
        let subRes = await getSub(fileName, "su", dynamodb)
        let name = getWord(subRes.Items[0].a, dynamodb)
        return {
            "input": [
                {
                    "physical": [
                        [{}],
                    ]
                },
                {
                    "virtual": [

                    ]
                },
            ],
            "published": {
                "blocks": [], "modules": {}, "actions": [{
                    "target": "{|res|}",
                    "chain": [
                        {
                            "access": "send",
                            "params": [
                                fileName
                            ]
                        }
                    ]
                }],
                "name": name.Items[0].s
            },
            "skip": [],
            "sweeps": 1,
            "expected": ['Joel Austin Hughes Jr.']
        }
    }
}

async function processConfig(config, initialContext, lib) {
    const context = { ...initialContext };
    if (config.modules) {
        for (const [key, value] of Object.entries(config.modules, context)) {
            let newPath = await installModule(value, key, context, lib);
        }
    }
    return context;
}

async function installModule(moduleName, contextKey, context, lib) {
    const npmConfigArgs = Object.entries({ cache: '/tmp/.npm-cache', prefix: '/tmp' })
        .map(([key, value]) => `--${key}=${value}`)
        .join(' ');

    let execResult = await exec(`npm install ${moduleName} --save ${npmConfigArgs}`);
    //console.log("execResult", execResult);
    lib.modules[moduleName.split("@")[0]] = { "value": moduleName.split("@")[0], "context": {} };

    const moduleDirPath = path.join('/tmp/node_modules/', moduleName.split("@")[0]);
    let modulePath;

    try {
        const packageJsonPath = path.join(moduleDirPath, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

        if (packageJson.exports && packageJson.exports.default) {
            modulePath = path.join(moduleDirPath, packageJson.exports.default);
        } else if (packageJson.main) {
            modulePath = path.join(moduleDirPath, packageJson.main);
        } else {
            modulePath = path.join(moduleDirPath, 'index.js');
        }
    } catch (err) {
        console.warn(`Could not read package.json for ${moduleName}, defaulting to index.js`);
        modulePath = path.join(moduleDirPath, 'index.js');
    }

    let module;
    try {
        module = require(modulePath);
    } catch (error) {
        try {
            module = await import(modulePath);
        } catch (importError) {
            console.error(`Failed to import ES module at ${modulePath}:`, importError);
            throw importError;
        }
    }

    if (contextKey.startsWith('{') && contextKey.endsWith('}')) {
        const keys = contextKey.slice(1, -1).split(',').map(key => key.trim());
        for (const key of keys) {
            if (module[key]) {
                context[key] = { "value": module[key], "context": {} };
            } else if (module.default && module.default[key]) {
                context[key] = { "value": module.default[key], "context": {} };
            } else {
                console.warn(`Key ${key} not found in module ${moduleName}`);
            }
        }
    } else {
        if (module.default) {
            context[contextKey] = { "value": module.default, "context": {} };
        } else {
            context[contextKey] = { "value": module, "context": {} };
        }
    }

    //console.log("context", JSON.stringify(context));
}

function getPageType(urlPath) {
    if (urlPath.toLowerCase().includes("sc")) {
        return "sc"
    } else if (urlPath.toLowerCase().includes("mc")) {
        return "mc"
    } else if (urlPath.toLowerCase().includes("sa")) {
        return "sa"
    } else if (urlPath.toLowerCase().includes("ma")) {
        return "ma"
    } else if (urlPath.toLowerCase().includes("blank")) {
        return "blank"
    } else {
        return "1var"
    }
}

async function initializeMiddleware(req, res, next) {
    //console.log("runApp3")

    if (req.path == "/") {
        req.dynPath = "/cookies/runEntity"
    } else {
        req.dynPath = req.path
    }

    //console.log("req.dynPath", req.dynPath)

    if (req.dynPath.startsWith('/auth') || req.dynPath.startsWith('/blocks') || req.dynPath.startsWith('/cookies/runEntity')) {
        //console.log("runApp4")
        let originalHost = req.body.headers["X-Original-Host"];
        let splitOriginalHost = originalHost.split("1var.com")[1]
        let reqPath = splitOriginalHost.split("?")[0]
        reqPath = reqPath.replace("/cookies/runEntity", "")
        //console.log("reqPath", reqPath)
        req.dynPath = reqPath
        let head
        let cookie
        let parent
        let fileArray
        let xAccessToken = req.body.headers["X-accessToken"]
        if (reqPath.split("/")[1] == "api") {
            //console.log("runApp5")
            head = await getHead("su", reqPath.split("/")[2], dynamodb)
            cookie = await manageCookie({}, req, xAccessToken, dynamodb, uuidv4)
            //console.log("req.body", req.body)
            parent = await convertToJSON(head.Items[0].su, [], null, null, cookie, dynamodb, uuidv4, null, null, null, null, dynamodbLL, req.body)
            fileArray = parent.paths[reqPath.split("/")[2]];
        } else {

            //console.log("runApp6")
            head = await getHead("su", reqPath.split("/")[1], dynamodb)
            //console.log("runApp6.1")
            cookie = await manageCookie({}, xAccessToken, res, dynamodb, uuidv4)
            //console.log("runApp6.2")
            //console.log("head.Items[0].su", head.Items[0].su)
            //console.log("req.body", req.body)
            parent = await convertToJSON(head.Items[0].su, [], null, null, cookie, dynamodb, uuidv4, null, null, null, null, dynamodbLL, req.body)
            //console.log("runApp6.3")
            //console.log("parent")
            fileArray = parent.paths[reqPath.split("/")[1]];
        }
        //console.log("runApp6.4")
        let isPublic = head.Items[0].z
        //console.log("#1cookie", cookie)
        //console.log("#1parent", parent)
        //console.log("head", head);
        //console.log("fileArray", fileArray);


        if (fileArray != undefined) {
            const promises = fileArray.map(async fileName => await retrieveAndParseJSON(fileName, isPublic, getSub, getWord));
            const results = await Promise.all(promises);
            //console.log("RESULTS87", results)
            //console.log("req.blocks", req.blocks)

            if (req.blocks) {
                //console.log("results", results)
                return results
            } else {
                const arrayOfJSON = [];

                //console.log("results", results)
                results.forEach(result => arrayOfJSON.push(result));
                //console.log("arrayOfJSON", arrayOfJSON)
                let resit = res
                let resultArrayOfJSON = arrayOfJSON.map(async userJSON => {
                    return async (req, res, next) => {
                        //console.log("req.body", JSON.stringify(req.body))
                        req.lib.root.context.body = { "value": req.body.body, "context": {} }
                        //console.log("userJSON", userJSON)
                        userJSON = await replaceSpecialKeysAndValues(userJSON, "first", req, res, next)
                        req.lib.root.context = await processConfig(userJSON, req.lib.root.context, req.lib);
                        req.lib.root.context["urlpath"] = { "value": reqPath, "context": {} }
                        req.lib.root.context["entity"] = { "value": fileArray[fileArray.length - 1], "context": {} };
                        req.lib.root.context["pageType"] = { "value": getPageType(reqPath), "context": {} };
                        req.lib.root.context["sessionID"] = { "value": req.sessionID, "context": {} }
                        req.lib.root.context.req = { "value": res.req, "context": {} }
                        req.lib.root.context.res = { "value": resit, "context": {} }
                        req.lib.root.context.math = { "value": math, "context": {} }
                        req.lib.root.context.axios = { "value": boundAxios, "context": {} }
                        req.lib.root.context.fs = { "value": fs, "context": {} }
                        req.lib.root.context.JSON = { "value": JSON, "context": {} }
                        req.lib.root.context.Buffer = { "value": Buffer, "context": {} }
                        req.lib.root.context.path = { "value": reqPath, "context": {} }
                        req.lib.root.context.console = { "value": console, "context": {} }
                        req.lib.root.context.util = { "value": util, "context": {} }
                        req.lib.root.context.child_process = { "value": child_process, "context": {} }
                        req.lib.root.context.moment = { "value": moment, "context": {} }
                        req.lib.root.context.s3 = { "value": s3, "context": {} }
                        req.lib.root.context.email = { "value": userJSON.email, "context": {} }
                        req.lib.root.context.promise = { "value": Promise, "context": {} }
                        //console.log("pre-initializeModules", req.lib.root.context)
                        //console.log("pre-lib", req.lib)
                        req.body.params = await initializeModules(req.lib, userJSON, req, res, next);

                        if (
                            req.body.params &&
                            typeof req.body.params === "object" &&
                            req.body.params._isFunction !== undefined
                        ) {
                            /* bubble straight back to runMiddleware */
                            return req.body.params;
                        }

                        /* otherwise fall through and call next() */
                        if (typeof next === "function") await next();
                        //console.log("post-initializeModules", req.lib.root.context)

                        //console.log("post-lib", req.lib)
                        //console.log("req1", req)
                        //console.log("res.req", res.req.ip)
                        //console.log("userJSON", userJSON)

                    };
                });
                return await Promise.all(resultArrayOfJSON)
            }
        } else {
            return []
        }
    }
}

async function initializeModules(libs, config, req, res, next) {
    await require('module').Module._initPaths();
    for (const action of config.actions) {
        let runResponse
        if (typeof action == "string") {
            dbAction = await getValFromDB(action, req, res, next)
            //console.log(dbAction)
            respoonse = await runAction(dbAction, libs, "root", req, res, next);
        } else {
            response = await runAction(action, libs, "root", req, res, next);
        }

        //console.log("bubble chain params in processAction7")
        if (typeof response == "object") {
            //console.log("bubble chain params in processAction8")
            if (response.hasOwnProperty("_isFunction")) {
                //console.log("bubble chain params in processAction9")
                return response
            }
        }
        if (runResponse == "contune") {
            continue
        }
    }
}

async function getValFromDB(id, req, res, next) {
    if (id.startsWith("{|")) {

        const keyExecuted = id.endsWith('|}!');
        const keyObj = await isOnePlaceholder(id);
        let keyClean = await removeBrackets(id, keyObj, keyExecuted);
        //console.log("keyClean:before", keyClean)
        keyClean = keyClean.replace(">", "")
        keyClean = keyClean.replace("<", "")
        //console.log("keyClean:after", keyClean)
        let subRes = await getSub(keyClean, "su", dynamodb)
        //console.log("subRes", subRes)
        let xAccessToken = req.body.headers["X-accessToken"]
        let cookie = await manageCookie({}, xAccessToken, res, dynamodb, uuidv4)
        //console.log("cookie33", cookie)
        let { verified } = await verifyThis(keyClean, cookie, dynamodb, req.body)
        //console.log("verified33", verified)
        if (verified) {
            let subRes = await getSub(keyClean, "su", dynamodb)
            //console.log("subRes", subRes)
            //console.log("subRes.Items[0].a", subRes.Items[0].a)
            let subWord = await getWord(subRes.Items[0].a, dynamodb)
            //console.log("subWord", subWord)
            value = subWord.Items[0].r
            //console.log(value)
            return JSON.parse(value)
        } else {
            return {}
        }
    }
}

async function deepMerge(obj1, obj2) {
    if (typeof obj1 !== 'object' || obj1 === null) return obj2;
    if (typeof obj2 !== 'object' || obj2 === null) return obj2;
    const result = Array.isArray(obj1) ? [...obj1] : { ...obj1 };
    for (const key in obj2) {
        if (obj2.hasOwnProperty(key)) {
            if (typeof obj2[key] === 'object' && obj2[key] !== null && !Array.isArray(obj2[key])) {
                result[key] = await deepMerge(result[key] || {}, obj2[key]);
            } else {
                result[key] = obj2[key];
            }
        }
    }
    return result;
}

function updateLevel(obj, replacer) {
    for (const [key, value] of Object.entries(replacer)) {
        if (value !== null) {
            obj[key] = value;
        } else {
            delete obj[key]
        }
    }
    return obj
}

function ifDB(str, time) {
    if (time == "first") {
        return str.startsWith('{|<')
    } else if (time == "last") {
        return str.endsWith('>|}')
    }
}

async function replaceSpecialKeysAndValues(obj, time, req, res, next) {
    let entries = Object.entries(obj)
    for (const [key, value] of entries) {
        if (typeof value === 'object' && value !== null && !key.startsWith("{|")) {
            await replaceSpecialKeysAndValues(obj[key], time, req, res, next)
        } else if (typeof value == "string") {
            //console.log("ifDB1", ifDB(key, time), key, time)
            if (ifDB(value, time)) {
                replacer = await getValFromDB(value, req, res, next)
                obj[key] = replacer
                for (k in replacer) {
                    if (replacer[k] == null) {
                        delete obj[key][k]
                    }
                }
            }
            //console.log("ifDB2", ifDB(key, time), key, time)
            if (ifDB(key, time)) {
                const dbValue = await getValFromDB(key, req, res, next);
                obj = await updateLevel(obj, dbValue);
            }
            //console.log("ifDB3", ifDB(key, time), key, time)
            if (ifDB(key, time)) {
                delete obj[key]
            }
        } else if (typeof value === 'object' && value !== null && key.startsWith("{|")) {
            //console.log("ifDB4", ifDB(key, time), key, time)
            if (ifDB(key, time)) {
                replacer = JSON.parse(JSON.stringify(obj[key]))
                let deep = await deepMerge(obj[key], await getValFromDB(key, req, res, next));
                obj = await updateLevel(obj, deep)
            }
            //console.log("ifDB5", ifDB(key, time), key, time)
            if (ifDB(key, time)) {
                delete obj[key]
            }
        }
    }
    return obj
}

async function getNestedContext(libs, nestedPath, key = "") {
    //console.log("getNestedContext")
    //console.log("libs", libs)
    //console.log("nestedPath", nestedPath)
    //console.log("key", key)
    if (key.startsWith("~/")) {
        nestedPath = key.replace("~/", "root.").split(".")
        //console.log("333: nestedPath", nestedPath)
        nestedPath = nestedPath.slice(0, -1).join('.')
    }

    let arrowJson = nestedPath.split("=>")
    if (nestedPath.includes("=>")) {
        nestedPath = arrowJson[0]
    }
    //console.log("444: nestedPath", nestedPath)
    const parts = nestedPath.split('.');

    //console.log("parts", parts)
    if (nestedPath && nestedPath != "") {
        let tempContext = libs;
        let partCounter = 0
        for (let part of parts) {
            //console.log("part", part)
            //console.log("parts[part]", parts[part])
            //console.log("tempContext", tempContext)
            //console.log("tempContext", tempContext[part])
            //console.log("tempContext", tempContext[part].context)
            tempContext = tempContext[part].context;
        }

        //console.log("tempContext", tempContext)
        return tempContext;
    }
    //console.log("libs", libs)
    return libs
}

async function getNestedValue(libs, nestedPath) {
    const parts = nestedPath.split('.');
    if (nestedPath && nestedPath != "") {
        let tempContext = libs;
        let partCounter = 0
        for (let part of parts) {

            if (partCounter < parts.length - 1 || partCounter == 0) {
                tempContext = tempContext[part].context;
            } else {
                tempContext = tempContext[part].value;
            }
        }
        return tempContext;
    }
    return libs
}

async function condition(left, conditions, right, operator = "&&", libs, nestedPath) {

    if (!Array.isArray(conditions)) {
        conditions = [{ condition: conditions, right: right }];
    }

    return conditions.reduce(
        async (accPromise, cond) => {
            const acc = await accPromise;                  // ← wait
            const cur = await checkCondition(left, cond.condition, cond.right, libs, nestedPath);
            return operator === '&&' ? acc && cur : acc || cur;
        },
        Promise.resolve(operator === '&&')                 // ← start with a Promise
    );



}

async function checkCondition(left, condition, right, libs, nestedPath) {
    const leftExecuted = false;
    if (typeof left == "string") {
        left.endsWith('|}!');
    }
    const rightExecuted = false;
    if (typeof right == "string") {
        right.endsWith('|}!');
    }
    left = await replacePlaceholders(left, libs, nestedPath, leftExecuted)
    right = await replacePlaceholders(right, libs, nestedPath, rightExecuted)
    switch (condition) {
        case '==': return left == right;
        case '===': return left === right;
        case '!=': return left != right;
        case '!==': return left !== right;
        case '>': return left > right;
        case '>=': return left >= right;
        case '<': return left < right;
        case '<=': return left <= right;
        case 'startsWith': return typeof left === 'string' && left.startsWith(right);
        case 'endsWith': return typeof left === 'string' && left.endsWith(right);
        case 'includes': return typeof left === 'string' && left.includes(right);
        case 'isDivisibleBy': return typeof left === 'number' && typeof right === 'number' && right !== 0 && left % right === 0;
        default:
            if (!condition && !right) {
                return !!left;
            }
            throw new Error("Invalid condition type");
    }
}


async function replacePlaceholders(item, libs, nestedPath, actionExecution, returnEx = true) {
    let processedItem = item;

    if (typeof processedItem === 'string') {

        let stringResponse = await processString(processedItem, libs, nestedPath, actionExecution, returnEx);
        return stringResponse;
    } else if (Array.isArray(processedItem)) {
        let newProcessedItems = await Promise.all(processedItem.map(async element => {
            let isExecuted = false
            if (typeof element == "string") {
                element.endsWith('|}!');
            }
            return await replacePlaceholders(element, libs, nestedPath, isExecuted, true);
        }));
        return await Promise.all(newProcessedItems);
    } else if (typeof processedItem === 'object' && processedItem !== null) {
        let newObject = {};
        for (let key in processedItem) {
            if (processedItem.hasOwnProperty(key)) {
                let isExecuted = false
                if (typeof processedItem[key] == "string") {
                    isExecuted = processedItem[key].endsWith('|}!');
                }
                newObject[key] = await replacePlaceholders(processedItem[key], libs, nestedPath, isExecuted, true);
            }
        }
        return newObject;
    } else {
        return item;
    }
}

async function isOnePlaceholder(str) {
    if (str.startsWith("{|") && (str.endsWith("|}") || str.endsWith("|}!")) && !str.includes("=>") && !str.includes("[") && !str.includes("{|=")) {
        return str.indexOf("{|", 2) === -1;
    }
    return false;
}

async function removeBrackets(str, isObj, isExecuted) {
    return isObj ? str.slice(2, isExecuted ? -3 : -2) : str
}

async function getKeyAndPath(str, nestedPath) {
    let val = str.split(".");

    let key = str;
    let path = "";
    if (str.startsWith("~/")) {
        val[0] = val[0].replace("~/", "")
        val.unshift("root")
    }
    if (val.length > 1) {
        key = val[val.length - 1]
        path = val.slice(0, -1)
        path = path.join(".")
    }
    if (nestedPath != "" && !str.startsWith("~/")) {
        path = nestedPath + "." + path
    } else {
        path = path
    }
    if (path.endsWith(".")) {
        path = path.slice(0, -1)
    }
    return { "key": key, "path": path }
}

function getValueFromPath(obj, path) {
    return path.split('.').reduce((current, key) => {
        return current && current && current[key] ? current[key] : null;
    }, obj);
}

function isNumber(value) {
    return typeof value === 'number' && !isNaN(value);
}

function isArray(string) {
    if (string.startsWith("[")) {
        try {
            const parsed = JSON.parse(string);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed
            } else {
                return false
            }
        } catch (error) {
            return false
        }
    } else {
        return false
    }
}

function isMathEquation(expression) {
    try {
        math.parse(expression);
        return true;
    } catch {
        return false;
    }
}

function evaluateMathExpression(expression) {
    try {
        const result = math.evaluate(expression);
        return result;
    } catch (error) {

        return null;
    }
}

function replaceWords(input, obj) {

    return input.replace(/\[(\w+)]/g, (match, word) => {
        if (!isNaN(word)) {
            return match;
        }

        if (!/^\".*\"$/.test(word)) {
            if (isContextKey(word, obj)) {
                return `["||${word}||"]`;
            }
        }
        return match;
    });
}

function isContextKey(searchKey, obj) {
    if (obj.hasOwnProperty(searchKey)) {
        return true;
    }

    for (let key in obj) {
        if (key != "req" && key != "res" && key != "session" && key != "body" && key != "urlpath" && key != "sessionID") {
            if (typeof obj[key] === 'object') {
                const result = isContextKey(searchKey, obj[key]);
                if (result) {
                    return true;
                }
            }
        }
    }

    return false;
}

function isNestedArrayPlaceholder(str) {
    return str.toString().startsWith("||") && str.toString().endsWith("||");
}

function evaluateMathExpression2(expression) {
    try {
        const result = math.evaluate(expression);
        return result;
    } catch (error) {
        return null;
    }
}

async function replacePlaceholders2(str, libs, nestedPath = "") {
    //console.log("AAAAAAAA")
    //console.log("libs", libs)

    let json = libs.root.context
    function getValueFromJson2(path, json, nestedPath, forceRoot) {
        //console.log("getValueFromJson2", path, json, nestedPath, forceRoot)
        let current = json;
        if (!forceRoot && nestedPath) {
            const nestedKeys = nestedPath.split('.');
            for (let key of nestedKeys) {
                if (current.hasOwnProperty(key)) {
                    current = current[key];
                } else {
                    console.error(`Nested path ${nestedPath} not found in JSON.`);
                    return '';
                }
            }
        }

        let arrayAccess = path.split('=>');
        let keys = arrayAccess[0].split('.');
        let keys2 = []
        let index = null;
        if (arrayAccess.length > 1) {
            keys2 = arrayAccess[1].split('.');
            if (arrayAccess[1].includes("[")) {
                index = arrayAccess[1].slice(0, -1).split("[")[1]
                index = parseInt(index);
                keys2 = arrayAccess[1].split("[")[0].split('.');
            }
        }

        let curCounter = 0
        if (current.value) {
            if (Object.keys(current.value).length == 0) {
                current = current.context
            }
        }
        for (let key of keys) {

            //console.log("LL2", key)
            //console.log("LL3", current);
            //console.log("LL4", current[key]);
            //console.log("LL5", keys.length - 1, curCounter);
            if (keys.length - 1 > curCounter) {
                //console.log("LL6")
                try { current = current[key].context } catch (err) { console.log(err) }
            } else {
                //console.log("LL7")
                try {
                    if (current[key].hasOwnProperty("value")) {
                        //console.log("LL8")
                        current = current[key].value
                    } else {
                        //console.log("LL9")
                        current = current[key]
                    }
                } catch (err) {
                    //console.log("LL10")
                    //console.log(err)
                    //console.log("current", current)
                    //console.log("current[key]", current[key])
                    current = current[key]
                    if (!current) {
                        //console.log("returning key", key)
                        return key
                    }

                }

            }
            curCounter++;
        }

        function isValidJSON(string) {
            try {
                JSON.parse(string);
                return true;
            } catch (error) {
                return false;
            }
        }

        if (isValidJSON(current)) {
            //console.log("isValidJSON", true)
            current = JSON.parse(current)
        }
        //console.log("current = ", current)
        for (let key of keys2) {
            //console.log("k2.07: key", key)
            //console.log("k2.08: typeof", typeof current)
            //console.log("k2.09: curent", current)
            //console.log("k2.1:", current.hasOwnProperty(key))
            //console.log("k2.3:", current.hasOwnProperty("value"))
            if (current.hasOwnProperty(key)) {
                current = current[key];
                //console.log("k2.4", current)
                if (current && typeof current === 'object' && current.hasOwnProperty('value')) {
                    current = current.value;
                }
            } else if (current.hasOwnProperty("value")) {
                current = current[key];
                //console.log("k2.5", current)
                //return '';
            }
            curCounter++;
        }

        //console.log("index", index)
        //console.log("current", current)
        //console.log("Array.isArray(current)", Array.isArray(current))
        if (index !== null && Array.isArray(current)) {
            if (index >= 0 && index < current.length) {
                current = current[index];
            } else {
                console.error(`Index ${index} out of bounds for array.`);
                return '';
            }
        }

        return current;
    }

    async function replace2(str, nestedPath) {
        //console.log("BBBBBBBB")
        //console.log("str", str)
        //console.log("nestedPath", nestedPath)
        let regex = /{\|(~\/)?([^{}]+)\|}/g;
        let match;
        let modifiedStr = str;

        while ((match = regex.exec(str)) !== null) {
            //console.log("CCCCCCCCCC")
            let forceRoot = match[1] === "~/";
            let innerStr = match[2];
            if (/{\|.*\|}/.test(innerStr)) {
                innerStr = await replace2(innerStr, nestedPath);
            }

            let value;
            //console.log("innerStr", innerStr)
            if (innerStr.startsWith("=")) {
                let expression = innerStr.slice(1);
                value = await evaluateMathExpression2(expression);
            } else if (innerStr.endsWith(">")) {
                //console.log("INSIDE > ")

                let getEntityID = innerStr.replace(">", "")
                if (innerStr.replace(">", "") == "1v4rcf97c2ca-9e4f-4bed-b245-c141e37bcc8a") {
                    getEntityID = "1v4r55cb7706-5efe-4e0d-8a40-f63b90a991d3"
                }

                let subRes = await getSub(getEntityID, "su", dynamodb)
                //console.log("subRes", subRes)
                //console.log("subRes.Items[0].a", subRes.Items[0].a)
                let subWord = await getWord(subRes.Items[0].a, dynamodb)
                //console.log("subWord", subWord)
                value = subWord.Items[0].s
            } else {
                //console.log("DDDDDDDDDDD")
                //console.log("forceRoot", forceRoot)
                //console.log("nestedPath", nestedPath)
                value = await getValueFromJson2(innerStr, json || {}, nestedPath, forceRoot);
                //console.log("value from json 2", value)
                //console.log("typeof from json 2", typeof value)
            }


            const arrayIndexRegex = /{\|\[(.*?)\]=>\[(\d+)\]\|}/g;
            const jsonPathRegex = /{\|((?:[^=>]+))=>((?:(?!\[\d+\]).)+)\|}/;



            if (typeof value === "string" || typeof value === "number") {
                //console.log("value is string or number")
                modifiedStr = modifiedStr.replace(match[0], value.toString());





            } else {
                //console.log("str2", str);
                //console.log("modifiedStr", modifiedStr);
                const isObj = await isOnePlaceholder(str)
                //console.log("isObj", isObj);
                if (isObj && typeof value == "object") {
                    //console.log("object", value)
                    return value;
                } else {
                    //console.log("stringify", value)
                    try {
                        if (typeof value != "function") {
                            modifiedStr = modifiedStr.replace(match[0], JSON.stringify(value));
                        } else {
                            return value
                        }
                    } catch (err) {
                        //console.log("err", err);
                        modifiedStr = value;
                    }
                }
            }

            if (arrayIndexRegex.test(str)) {
                //console.log("arrayIndexRegex.test", str)
                let updatedStr = str.replace(arrayIndexRegex, (match, p1, p2) => {
                    //console.log("match", match, p1, p2)
                    let strArray = p1.split(',').map(element => element.trim().replace(/^['"]|['"]$/g, ""));
                    let index = parseInt(p2);
                    return strArray[index] ?? "";
                });
                //console.log("updatedStr", updatedStr)
                return updatedStr
            } else if (jsonPathRegex.test(modifiedStr) && !modifiedStr.includes("[") && !modifiedStr.includes("=>")) {
                //console.log("jsonPathRegex", jsonPathRegex)
                let updatedStr = modifiedStr.replace(jsonPathRegex, (match, jsonString, jsonPath) => {
                    //console.log("modifiedStr", modifiedStr)
                    //console.log("match", match),
                        //console.log("jsonString", jsonString)
                    //console.log("jsonPath", jsonPath)
                    jsonPath = jsonPath.replace("{|", "").replace("|}!", "").replace("|}", "")
                    try {
                        const jsonObj = JSON.parse(jsonString);
                        const pathParts = jsonPath.split('.');
                        let currentValue = jsonObj;
                        //console.log("JSON PATH B1", jsonObj)
                        //console.log("JSON PATH B2", pathParts)
                        //console.log("JSON PATH B3", currentValue)
                        for (const part of pathParts) {
                            if (currentValue.hasOwnProperty(part)) {
                                currentValue = currentValue[part];
                            } else {
                                break;
                            }
                        }
                        //console.log("JSON PATH B4", currentValue)
                        return JSON.stringify(currentValue) ?? "";
                    } catch (e) {
                        //console.log(`Error parsing JSON: ${e}`);
                    }
                });
                //console.log("JSON PATH B5", updatedStr)
                //console.log("JSON PATH B6", JSON.stringify(updatedStr))
                if (updatedStr != "") {
                    return updatedStr;
                }

            }
        }

        if (modifiedStr.match(regex)) {
            //console.log("modifiedStr.match", modifiedStr)
            return await replace2(modifiedStr, nestedPath);
        }
        //console.log("after modified", modifiedStr)
        return modifiedStr;
    }

    let response = await replace2(str, nestedPath);
    //console.log("response", response)
    return response
}

const str88 = "{{={{people.{{first}}{{last}}.age}} + 10}}";

const json88 = {
    "context": {
        "first": {
            "value": "adam",
            "context": {}
        },
        "last": {
            "value": "smith",
            "context": {}
        },
        "people": {
            "adamsmith": {
                "age": {
                    "value": "31",
                    "context": {}
                }
            }
        }
    },
    "value": ""
};

async function processString(str, libs, nestedPath, isExecuted, returnEx) {
    //console.log("~1")
    //console.log("str", str)
    //console.log("nestedPath")
    //console.log("isExecuted", isExecuted)

    //console.log("libs.root.context", libs.root.context)


    let newNestedPath = nestedPath
    if (nestedPath.startsWith("root.")) {
        //console.log("~4")
        newNestedPath = newNestedPath.replace("root.", "")
    } else if (nestedPath.startsWith("root")) {
        //console.log("~5")
        newNestedPath = newNestedPath.replace("root", "")
    }

    //console.log("----------------",)
    //console.log("str", str)
    //console.log("newNestedPath", newNestedPath)

    let mmm = await replacePlaceholders2(str, libs, newNestedPath)
    //console.log("typeof", typeof mmm)
    //console.log("MMM2", mmm)


    const isObj = await isOnePlaceholder(str)
    //console.log("isObj", isObj)
    if ((isObj || typeof libs.root.context[str] === "object") && !str.includes(">|}")) {
        //console.log("~6")
        let strClean
        target = await getKeyAndPath(str.replace("{|", "").replace("|}!", "").replace("|}", ""), nestedPath)
        //console.log("target", target)
        let nestedValue = await getNestedValue(libs, target.path)
        //console.log("nestedValue", nestedValue)
        //console.log("nestedValue[target.key]", nestedValue[target.key])
        try {
            //console.log("nestedValue[target.key].value", nestedValue[target.key].value)
            mmm = nestedValue[target.key].value
        } catch (e) {
            //console.log("nestedValue[target.key]", nestedValue[target.key])
            //console.log("error", e)
            mmm = nestedValue[target.key]
        }
    } else {
        //console.log("~7")

    }


    //console.log("TYPEOF", typeof mmm)
    //console.log("MMM3", mmm)
    if (isExecuted && typeof mmm == "function" && returnEx) {
        mmm = await mmm();
        return mmm
        //console.log("executed", mmm)
    } else if (isExecuted && typeof mmm == "function" && !returnEx) {
        await mmm();
        return mmm
        //console.log("executed but did not return response", mmm)
    } else {
        //console.log("return", mmm)
        return mmm;
    }

}

async function runAction(action, libs, nestedPath, req, res, next) {
    if (action != undefined) {
        let runAction = true;
        if (action.if) {
            for (const ifObject of action.if) {
                runAction = await condition(ifObject[0], ifObject[1], ifObject[2], ifObject[3], libs, nestedPath);
                if (!runAction) {
                    break;
                }
            }
        }

        if (runAction) {
            if (action.while) {
                let whileCounter = 0
                for (const whileCondition of action.while) {

                    const while0Executed = whileCondition[0].endsWith('|}!');
                    const while2Executed = whileCondition[2].endsWith('|}!');
                    while (await condition(await replacePlaceholders(whileCondition[0], libs, nestedPath, while0Executed), [{ condition: whileCondition[1], right: await replacePlaceholders(whileCondition[2], libs, nestedPath, while2Executed) }], null, "&&", libs, nestedPath)) {

                        let leftSide1 = await replacePlaceholders(whileCondition[0], libs, nestedPath, while0Executed)
                        let conditionMiddle = whileCondition[1]
                        let rightSide2 = await replacePlaceholders(whileCondition[2], libs, nestedPath, while2Executed)

                        let resu = await processAction(action, libs, nestedPath, req, res, next);

                        //console.log("bubble chain params in processAction4.1")
                        if (typeof resu == "object") {
                            //console.log("bubble chain params in processAction4.2")
                            if (resu.hasOwnProperty("_isFunction")) {
                                //console.log("bubble chain params in processAction4.3")
                                return resu
                            }
                        }

                        whileCounter++;
                        if (whileCounter >= req.lib.whileLimit) {
                            break;
                        }
                    }
                }
            }

            if (!action.while) {
                let resu = await processAction(action, libs, nestedPath, req, res, next);

                //console.log("bubble chain params in processAction4")
                if (typeof resu == "object") {
                    //console.log("bubble chain params in processAction5")
                    if (resu.hasOwnProperty("_isFunction")) {
                        //console.log("bubble chain params in processAction6")
                        return resu
                    }
                }
            }

            if (action.assign && action.params) {
                return "continue";
            }

            if (action.execute) {
                return "continue";
            }
        }
    }
    return ""
}

async function addValueToNestedKey(key, nestedContext, value) {
    if (value == undefined || key == undefined) {
        ////console.log("key/value undefined")
    } else {
        key = key.replace("~/", "");
        if (!nestedContext.hasOwnProperty(key)) {
            nestedContext[key] = { "value": {}, "context": {} }
        }
        nestedContext[key].value = value;
    }
}

async function putValueIntoContext(contextPath, objectPath, value, libs, index) {

    let pathHolder = libs
    //console.log("###contextPath2.00", contextPath.slice(0, -1))
    for (const part of contextPath.slice(0, -1)) {
        //console.log("pathHolder", pathHolder)
        //console.log("part", part)
        if (pathHolder.hasOwnProperty(part)) {
            //console.log("pathHolder has part")
            if (pathHolder[part].hasOwnProperty("context")) {
                //console.log("part has context")
                pathHolder = pathHolder[part].context;
            } else {
                //console.log("part does noot have context")
                pathHolder = pathHolder[part];
            }
        }
    }
    //console.log("###pathHolder2.01", pathHolder)
    //console.log("###contextPath2.02", contextPath.length - 1)
    //console.log("###contextPath2.03", contextPath[contextPath.length - 1])
    if (pathHolder.hasOwnProperty(contextPath[contextPath.length - 1])) {
        //console.log("ggg1")
        if (pathHolder[contextPath[contextPath.length - 1]].hasOwnProperty("value")) {
            //console.log("ggg2")
            pathHolder = pathHolder[contextPath[contextPath.length - 1]].value;
        } else {
            //console.log("ggg3")
            pathHolder = pathHolder[contextPath[contextPath.length - 1]];
        }
    }
    //console.log("###pathHolder2.1", pathHolder)
    //console.log("###objectPath2.12", objectPath.slice(0, -1))
    for (const part of objectPath.slice(0, -1)) {
        if (pathHolder.hasOwnProperty(part)) {
            pathHolder = pathHolder[part];
        }
    }
    //console.log("###pathHolder2.22", pathHolder)
    //console.log("###objectPath2.22", objectPath[objectPath.length - 1])
    //console.log("value", value)
    //console.log("index", index)
    if (index != undefined) {
        pathHolder[objectPath[objectPath.length - 1]][index] = value
    } else {
        pathHolder[objectPath[objectPath.length - 1]] = value
    }
    //console.log("###pathHolder2.3", pathHolder)
}

async function processAction(action, libs, nestedPath, req, res, next) {
    let timeoutLength = 0

    if (action.timeout) {
        timeoutLength = action.timeout
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    if (timeoutLength > 0) {
        await delay(timeoutLength);
    }

    if (action.set) {
        for (const key in action.set) {

            const keyExecuted = key.endsWith('|}!');
            const keyObj = await isOnePlaceholder(key);
            let keyClean = await removeBrackets(key, keyObj, keyExecuted);
            //console.log("keyClean", keyClean)
            //console.log(key, nestedPath);
            let set
            if (keyObj) {
                //console.log("keyObj", keyObj)
                set = await getKeyAndPath(keyClean, nestedPath)
            } else {
                set = { "key": keyClean, "path": nestedPath }
            }
            //console.log("66: set", set);
            let nestedContext = await getNestedContext(libs, set.path, set.key);
            //console.log("66: nestedContext", nestedContext)
            try {
                //////////console.log("66:2 nestedContext", nestedContext.originalFunction)
            } catch (err) { }
            //console.log("66: action", action)
            //console.log("66: action.set[key]", action.set[key])
            function isValidJSON(string) {
                try {
                    JSON.parse(string);
                    return true;
                } catch (error) {
                    return false;
                }
            }
            let isJ = false
            let sending = action.set[key]
            if (typeof action.set[key] === "object") {
                isJ = true
                //sending = JSON.stringify(sending)
            }
            //console.log("sending", sending)
            //console.log("libs", libs)
            //console.log("nestedPath", nestedPath)
            let isEx = false
            if (typeof sending == "string") {
                isEx = sending.endsWith('|}!')
            }
            let value = await replacePlaceholders(sending, libs, nestedPath, isEx)
            //console.log("isJ", isJ)
            if (isJ) {
                //console.log("value before", value)
                try {
                    if (Buffer.isBuffer(value)) {
                        //console.log("pdfData is a buffer");
                        //value = value
                    } else if (typeof value === 'object' && value !== null) {
                        //value = JSON.parse(value)
                        //console.log("pdfData is likely a JSON object");
                    } else {
                        //console.log("pdfData is neither a buffer nor a JSON object");
                    }

                } catch (err) {
                    //console.log("err61111", err)
                }
                //console.log("value after", value)
            }
            //console.log("66: value", value)

            //console.log("key startsWith <|} ", key)
            if (key.endsWith("<|}")) {

                //console.log("keyClean", keyClean)
                keyClean = keyClean.replace("<", "")
                //console.log("keyClean", keyClean)
                set.key = keyClean
                let subRes = await getSub(keyClean, "su", dynamodb)
                //console.log("subRes", subRes)
                let xAccessToken = req.body.headers["X-accessToken"]
                let cookie = await manageCookie({}, xAccessToken, res, dynamodb, uuidv4)
                //console.log("cookie33", cookie)
                let { verified } = await verifyThis(keyClean, cookie, dynamodb, req.body)
                //console.log("verified33", verified)
                if (verified) {
                    //console.log("verified!!!!!!!")
                    const aNew = await incrementCounterAndGetNewValue('wCounter', dynamodb);
                    //console.log("aNew", aNew)
                    let nonObj = ""
                    //console.log("isJ", isJ)
                    if (isJ) {
                        nonObj = JSON.stringify(value)
                    } else {
                        nonObj = value
                    }
                    //console.log("nonObj", nonObj)
                    const a = await createWord(aNew.toString(), nonObj, dynamodb);
                    //console.log("a", a)
                    params1 = {
                        "TableName": 'subdomains',
                        "Key": { "su": keyClean },
                        "UpdateExpression": `set a = :val`,
                        "ExpressionAttributeValues": {
                            ':val': a
                        }
                    };
                    let resRes = await dynamodb.update(params1).promise();
                    //console.log("resRes", resRes)



                    const eParent = await getEntity(subRes.Items[0].e.toString(), dynamodb)

                    params2 = {
                        "TableName": 'groups',
                        "Key": { "g": eParent.Items[0].g.toString() },
                        "UpdateExpression": `set a = :val`,
                        "ExpressionAttributeValues": {
                            ':val': a
                        }
                    };
                    let resPres = await dynamodb.update(params2).promise();
                    //console.log("resPres", resPres)

                    const details2 = await addVersion(subRes.Items[0].e.toString(), "a", a.toString(), "1", dynamodb);
                    //console.log("details2", details2)
                    const updateParent = await updateEntity(subRes.Items[0].e.toString(), "a", a.toString(), details2.v, details2.c, dynamodb);
                    //console.log("updateParent", updateParent)
                }
            }

            let arrowJson = keyClean.split("=>")
            //console.log("66: arrowJson", arrowJson)
            if (arrowJson.length > 1) {
                let index
                if (arrowJson[1].includes("[")) {
                    index = arrowJson[1].slice(0, -1).split("[")[1]
                    arrowJson[1] = arrowJson[1].slice(0, -1).split("[")[0]
                }
                const pathParts = arrowJson[1].split('.');
                //console.log("66: pathParts", pathParts)
                let firstParts = arrowJson[0].replace("~/", "root.").split('.')
                //console.log("###firstParts", firstParts)
                //console.log("###pathParts", pathParts)
                //console.log("###value", value)
                //console.log("###libs", libs)
                if (index != undefined) {
                    if (index.includes("{|")) {
                        index = index.replace("{|", "").replace("|}!", "").replace("|}", "")
                        index = libs.root.context[index.replace("{|", "").replace("|}!", "").replace("|}", "").replace("~/", "")]
                        index = parseInt(index.value.toString())
                    }
                }
                //console.log("putValueIntoContext")
                await putValueIntoContext(firstParts, pathParts, value, libs, index);
                //console.log("###libs3", libs)
                //console.log("###libs3", libs.root.context)
                //console.log("###libs3", libs.root.context.uploadParams)
            } else {
                //console.log("addValueToNestedKey")
                //console.log("set.key", set.key.replace("~/", ""))
                //console.log("nestedContext", nestedContext)
                //console.log("value", value)
                await addValueToNestedKey(set.key.replace("~/", ""), nestedContext, value);
                //console.log("libs.root.context", libs.root.context)
            }
        }
    }


    if (action.target) {
        console.log("action.target", action.target);
        const isObj = await isOnePlaceholder(action.target)
        let actionExecution = false
        if (action.target.endsWith('|}!')) {
            actionExecution = true
        }
        let assignExecuted = false;
        if (action.assign) {
            assignExecuted = action.assign.endsWith('|}!');
        }
        let strClean = await removeBrackets(action.target, isObj, actionExecution);
        let target
        if (isObj) {
            target = await getKeyAndPath(strClean, nestedPath)
        } else {
            target = { "key": strClean, "path": nestedPath }
        }
        let nestedContext = await getNestedContext(libs, target.path);

        if (!nestedContext.hasOwnProperty(target.key)) {
            nestedContext[target.key] = { "value": {}, "context": {} }
        }

        let ex = actionExecution;
        if (actionExecution && assignExecuted) {
            ex = false
        }

        value = await replacePlaceholders(target.key.replace("|", ""), libs, target.path, actionExecution, false);
        let args = [];

        if (value) {
            if (action.params) {
                //console.log("action.params", action.params)
                let promises = action.params.map(async item => {
                    //console.log("item", item);
                    //console.log("typeof item", typeof item)
                    try {
                        const fromExecuted = item.endsWith('|}!');
                        const fromObj = await isOnePlaceholder(item);
                        let fromClean = await removeBrackets(item, fromObj, fromExecuted);
                        let from
                        if (isObj) {
                            from = await getKeyAndPath(fromClean, nestedPath)
                        } else {
                            from = { "key": fromClean, "path": nestedPath }
                        }
                        let nestedContext = await getNestedContext(libs, from.path);

                        let value = await replacePlaceholders(item, libs, nestedPath, fromExecuted);
                        return value;
                    } catch (err) {
                        //console.log("err43", err)
                        return item
                    }
                });
                args = await Promise.all(promises)
                //console.log("args", args)
            }
            console.log("value", value)
            //console.log(typeof nestedContext[target.key].value)
            //console.log("args.length", args.length)
            if (typeof nestedContext[target.key].value === 'function' && args.length > 0) {
                nestedContext[target.key].value = value(...args);
            }
        }
        let newNestedPath = nestedPath
        result = await applyMethodChain(value, action, libs, newNestedPath, actionExecution, res, req, next);
        //console.log("bubble chain params in processAction1")
        if (typeof result == "object") {
            //console.log("bubble chain params in processAction2")
            if (result.hasOwnProperty("_isFunction")) {
                //console.log("bubble chain params in processAction3")
                return result
            }
        }
        //console.log("applyMethodChain result", result)
        if (action.assign) {
            const assignObj = await isOnePlaceholder(action.assign);
            let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
            let assign
            if (isObj) {
                assign = await getKeyAndPath(strClean, nestedPath)
            } else {
                assign = { "key": strClean, "path": nestedPath }
            }

            let nestedContext = await getNestedContext(libs, assign.path);
            //console.log("nestedContext", nestedContext)  //<<--- This is coming directly before post-initializeModules in the logs
            if (assignObj && assignExecuted && typeof result == "function") {
                let tempFunction
                if (action.chain) {
                    if (action.chain.express) {
                        tempFunction = () => result()(req, res, next);
                    } else {
                        //console.log("action", action)
                        //console.log("action.chain", action.chain)
                        //console.log("result", result)
                        tempFunction = () => result()
                    }
                } else {
                    tempFunction = () => result()
                }
                let newResult = tempFunction()
                await addValueToNestedKey(strClean, nestedContext, newResult)
            } else {
                await addValueToNestedKey(strClean, nestedContext, result)
            }
        }

    } else if (action.assign) {
        const assignExecuted = action.assign.endsWith('|}!');
        const assignObj = await isOnePlaceholder(action.assign);
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        let assign
        if (assignObj) {
            assign = await getKeyAndPath(strClean, nestedPath)
        } else {
            assign = { "key": strClean, "path": nestedPath }
        }
        let nestedContext = await getNestedContext(libs, assign.path);
        if (assignObj) {
            let result = await createFunctionFromAction(action, libs, assign.path, req, res, next)
            if (assignExecuted && typeof result === 'function') {
                result = await result()
            } else if (typeof result === 'function') {
                //result = result;
                //console.log("do nothing")
            } else {
                result = JSON.stringify(result);
            }
            await addValueToNestedKey(assign.key, nestedContext, result);
        } else {
            let result = await createFunctionFromAction(action, libs, assign.path, req, res, next)
            await addValueToNestedKey(action.assign, nestedContext, result);
        }
    }

    if (action.execute) {
        const isObj = await isOnePlaceholder(action.execute)
        let strClean = await removeBrackets(action.execute, isObj, false);
        let execute
        if (isObj) {
            execute = await getKeyAndPath(strClean, nestedPath)
        } else {
            execute = { "key": strClean, "path": nestedPath }
        }
        let nestedContext = await getNestedContext(libs, execute.path);
        let value = nestedContext[strClean]
        if (typeof value.value === 'function') {
            if (action.express) {
                if (!action.next) {
                    await value.value(req, res);
                } else {
                    await value.value(req, res, next);
                }
            } else {
                async function executeValue() {
                    //console.log("value.value()")
                    try {
                        const data = await value.value();
                        return data;
                    } catch (error) {
                        console.error('Failed to execute value function:', error.message);
                        throw error;
                    }

                }
                await executeValue()
                    .then(data => {
                        ////console.log('Fetched data:', data);
                    })
                    .catch(error => {
                        console.error('Error:', error.message);
                    });

            }
        } else {
            //console.error(`No function named ${strClean} found in context`);
        }
    }

    if (action.next) {
        next();
    }

}

async function applyMethodChain(target, action, libs, nestedPath, assignExecuted, res, req, next) {
    console.log("applyMethodChain target", target)
    let result = target

    if (nestedPath.endsWith(".")) {
        nestedPath = nestedPath.slice(0, -1)
    }

    if (nestedPath.startsWith(".")) {
        nestedPath = nestedPath.slice(1)
    }

    if (action.chain && result) {
        for (const chainAction of action.chain) {
            let chainParams;

            if (chainAction.hasOwnProperty('return')) {
                return chainAction.return;
            }

            if (chainAction.params) {

                //console.log("chainAction.params", chainAction.params)
                chainParams = await replacePlaceholders(chainAction.params, libs, nestedPath)
                //console.log("chainParams", chainParams)
            }
            let accessClean = chainAction.access
            if (accessClean) {
                const isObj = await isOnePlaceholder(accessClean)
                accessClean = await removeBrackets(accessClean, isObj, false);
            }
            //console.log("000")

            if (accessClean && (!chainAction.params || chainAction.params.length == 0) && !chainAction.new) {
                //console.log("111")
                if (chainAction.express) {
                    if (chainAction.next || chainAction.next == undefined) {
                        //console.log("chainAction.next")
                        result = await result[accessClean]()(req, res, next);
                        //console.log("req2", req)
                    } else {
                        result = await result[accessClean]()(req, res);
                        //console.log("req3", req)
                    }
                } else {
                    result = await result[accessClean]()
                }
            } else if (accessClean && chainAction.new && chainAction.params.length > 0) {
                //console.log("222")
                result = await new result[accessClean](...chainParams);
            } else if ((!accessClean || accessClean == "") && chainAction.new && (!chainAction.params || chainAction.params.length == 0)) {
                //console.log("333")
                result = await new result();
            } else if ((!accessClean || accessClean == "") && chainAction.new && chainAction.params.length > 0) {
                //console.log("444")
                //console.log("result", result)

                result = await new result(...chainParams);
            } else if (typeof result[accessClean] === 'function') {
                //console.log("555")
                if (chainAction.new) {
                    result = new result[accessClean](...chainParams);
                } else {
                    //console.log("666")
                    if (chainAction.access && accessClean.length != 0) {
                        //console.log("777")
                        if (chainAction.express) {
                            if (chainAction.next || chainAction.next == undefined) {
                                //console.log("chainAction.next")
                                result = await result[accessClean](...chainParams)(req, res, next);
                                //console.log(req)
                            } else {
                                result = await result[accessClean](...chainParams)(req, res);
                            }
                        } else {
                            try {
                                if (chainParams.length > 0) {
                                    if (typeof chainParams[0] == "number") {
                                        chainParams[0] = chainParams[0].toString();
                                    }
                                }
                                if (assignExecuted) {
                                    //console.log("assignExecuted")
                                    if ((accessClean == "json" || accessClean == "pdf") && action.target.replace("{|", "").replace("|}!", "").replace("|}", "") == "res") {
                                        chainParams[0] = JSON.stringify(chainParams[0])
                                        //console.log("returning", accessClean, "99999")
                                        result = await result[accessClean](...chainParams);
                                    } else {
                                        console.log("result 1", result),
                                            //console.log("accessClean 2", accessClean)
                                        //console.log("chainParams 3", chainParams)
                                        // 


                                        console.log("req.body", req.body);
                                        console.log("req.body._isFunction", req.body._isFunction)
                                        console.log("accessClean", accessClean)

                                        if (accessClean === 'send') {
                                            // ⤴ cookies.js called runApp as a function – do **not** touch Express
                                            if (req.body && req.body._isFunction) {
                                                // Bubble the would‑be response back to runApp / cookies.js
                                                console.log("return chainParams", chainParams)
                                                return chainParams.length === 1 ? { "chainParams": chainParams[0], "_isFunction": req.body._isFunction } : { "chainParams": chainParams, "_isFunction": req.body._isFunction };
                                            }
                                        }
                                        /* fallback to the original behaviour */
                                        console.log("fallback", chainParams)
                                        result = await result[accessClean](...chainParams);
                                        console.log("after completed result")
                                        //
                                        console.log("result 4", result)
                                        try {
                                            re = result();
                                        } catch (err) {
                                            console.log("err (Attempting result() in Try/Catch, It's OK if it fails.)", err)
                                        }
                                    }
                                } else {
                                    console.log("else just return value")
                                    result = result[accessClean];
                                }
                            } catch (err) {
                                console.log("err", err)
                            }
                        }
                    }
                }
            } else if (typeof result === 'function') {
                if (chainAction.new) {
                    result = new result(...chainParams);
                } else {
                    if (chainAction.express) {
                        if (chainAction.next || chainAction.next == undefined) {
                            result = await result(...chainParams)(req, res, next);
                        } else {
                            result = await result(...chainParams)(req, res);
                        }
                    } else {
                        try {
                            if (chainParams.length > 0) {
                                if (typeof chainParams[0] === "number") {
                                    chainParams[0] = chainParams[0].toString();
                                }
                            }
                            result = await result(...chainParams);
                        } catch (err) {
                            console.log("err", err)
                        }
                    }
                }
            } else if (assignExecuted && typeof result[accessClean] == "function") {
                result = result[accessClean](...chainParams)
            } else {
                try {
                    let result = libs.root.context[action.target.replace("{|", "").replace("|}!", "").replace("|}", "")].value[accessClean](...chainParams)
                } catch (err) { }
            }
        }
    }

    console.log("returning result", result)
    if (result == undefined) {
        result = {}
    }
    return result;
}

async function createFunctionFromAction(action, libs, nestedPath, req, res, next) {
    //console.log("11111111")
    //console.log("action", action)
    //console.log("libs", libs)
    //console.log("nestedPath", nestedPath)
    return async function (...args) {
        const assignExecuted = action.assign.endsWith('|}!');
        //console.log("55: assignExecuted", assignExecuted)
        const assignObj = await isOnePlaceholder(action.assign);
        //console.log("55: assignObj", assignObj)
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        //console.log("55: strClean", strClean)
        let assign
        if (assignObj) {
            assign = await getKeyAndPath(strClean, nestedPath)
        } else {
            assign = { "key": strClean, "path": nestedPath }
        }
        //console.log("55: assign", assign)
        let nestedContext = await getNestedContext(libs, assign.path);
        //console.log("createFunctionFromAction", assign.key, nestedContext)
        let result;
        //console.log("args", args)

        if (action.params && args.length) {
            for (const [idx, arg] of args.entries()) {
                //console.log("11: arg", arg);

                if (!arg) continue;

                if (typeof arg === "string") {
                    const paramExecuted1 = arg.endsWith("|}!");
                    const paramObj1 = await isOnePlaceholder(arg);
                    const paramClean1 = await removeBrackets(
                        arg, paramObj1, paramExecuted1);

                    const param1 = await getKeyAndPath(
                        paramClean1, nestedPath);
                    const nestedParamCtx1 = await getNestedContext(
                        libs, param1.path);

                    if (paramExecuted1 && paramObj1 && typeof arg === "function") {
                        nestedParamCtx1[param1.key] = await arg();
                    }
                }
            }



            let indexP = 0;
            for (par in action.params) {
                //console.log("par", par)
                let param2 = action.params[par]
                //console.log("22: param2", param2)
                if (param2 != null && param2 != "") {
                    const paramExecuted2 = param2.endsWith('|}!');
                    //console.log("22: paramExecuted2", paramExecuted2)
                    const paramObj2 = await isOnePlaceholder(param2);
                    //console.log("22: paramObj2", paramObj2)
                    let paramClean2 = await removeBrackets(param2, paramObj2, paramExecuted2);
                    //console.log("22: paramClean2", paramClean2)
                    let newNestedPath2 = nestedPath + "." + assign.key
                    //console.log("22: newNestedPath2", newNestedPath2)
                    let p
                    const isObj = await isOnePlaceholder(paramClean2)
                    if (isObj) {
                        p = await getKeyAndPath(paramClean2, newNestedPath2)
                    } else {
                        p = { "key": paramClean2, "path": newNestedPath2 }
                    }
                    //console.log("22: p", p)
                    let nestedParamContext2 = await getNestedContext(libs, p.path);
                    //console.log("22: addValue:", paramClean2, nestedParamContext2, args[indexP])
                    await addValueToNestedKey(paramClean2, nestedParamContext2, args[indexP])
                    //console.log("22: lib.root.context", libs.root.context);
                }
                indexP++
            }
        }


        if (action.nestedActions) {
            const nestedResults = [];
            for (const act of action.nestedActions) {
                let newNestedPath = `${nestedPath}.${assign.key}`;
                const result = await runAction(act, libs, newNestedPath, req, res, next);
                nestedResults.push(result);
            }
            result = nestedResults[0];
        }
        //console.log("YY return result", result)
        return result;

    };
}

const automate = async (url) => {
    try {
        const response = await axios.get(url);
        ////////console.log('URL called successfully:', response.data);
    } catch (error) {
        //console.error('Error calling URL:', error);
    }
};

const serverlessHandler = serverless(app);

const lambdaHandler = async (event, context) => {

    if (event.Records && event.Records[0].eventSource === "aws:ses") {

        let emailId = event.Records[0].ses.mail.messageId
        let emailSubject = event.Records[0].ses.mail.commonHeaders.subject
        let emailDate = event.Records[0].ses.mail.commonHeaders.date
        let returnPath = event.Records[0].ses.mail.commonHeaders.returnPath
        let emailTo = event.Records[0].ses.mail.commonHeaders.to
        let emailTarget = ""
        for (let to in emailTo) {
            if (emailTo[to].endsWith("email.1var.com")) {
                emailTarget = emailTo[to].split("@")[0]
            }
        }
        let subEmail = await getSub(emailTarget, "su", dynamodb)

        let isPublic = subEmail.Items[0].z.toString()

        let fileLocation = "private"
        if (isPublic == "true" || isPublic == true) {
            fileLocation = "public"
        }
        const params = { Bucket: fileLocation + '.1var.com', Key: emailTarget };
        const data = await s3.getObject(params).promise();
        if (data.ContentType == "application/json") {
            let s3JSON = await JSON.parse(data.Body.toString());
            s3JSON.email.unshift({ "from": returnPath, "to": emailTarget, "subject": emailSubject, "date": emailDate, "emailID": emailId })

            const params = {
                Bucket: fileLocation + ".1var.com",
                Key: emailTarget,
                Body: JSON.stringify(s3JSON),
                ContentType: "application/json"
            };
            await s3.putObject(params).promise();
        }



        return { statusCode: 200, body: JSON.stringify('Email processed') };
    }

    if (event.automate) {

        function isTimeInInterval(timeInDay, st, itInMinutes) {
            const timeInDayMinutes = Math.floor(timeInDay / 60);
            const stMinutes = Math.floor(st / 60);
            const diffMinutes = timeInDayMinutes - stMinutes;
            return diffMinutes >= 0 && diffMinutes % itInMinutes === 0;
        }


        var now = moment.utc();


        var timeInDay = now.hour() * 3600 + now.minute() * 60 + now.second();

        var now = moment.utc();
        var timeInDay = now.hour() * 3600 + now.minute() * 60 + now.second();

        var todayDow = now.format('dd').toLowerCase();
        var currentDateInSeconds = now.unix();
        const gsiName = `${todayDow}Index`;


        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

        const queryParams = {
            TableName: 'tasks',
            IndexName: gsiName,
            KeyConditionExpression: `#${todayDow} = :dowVal and sd < :currentDate`,
            ExpressionAttributeNames: {
                [`#${todayDow}`]: todayDow,
            },
            ExpressionAttributeValues: {
                ':dowVal': 1,
                ':currentDate': currentDateInSeconds,
            },
        };

        const data = await dynamodb.query(queryParams).promise();

        let urls = [];
        let check
        let interval
        for (const rec of data.Items) {
            check = isTimeInInterval(timeInDay.toString(), rec.st, rec.it);
            interval = rec.it
            if (check) {
                urls.push(rec.url);
            }
        }
        for (const url of urls) {
            await automate("https://1var.com/" + url);
            await delay(500);
        }
        return { "automate": "done" }
    }
    if (event.enable) {


        const en = await incrementCounterAndGetNewValue('enCounter', dynamodb);

        const today = moment();
        const tomorrow = moment().add(1, 'days');
        const dow = tomorrow.format('dd').toLowerCase();
        const gsiName = `${dow}Index`;

        const endOfTomorrowUnix = tomorrow.endOf('day').unix();

        const params = {
            TableName: "schedules",
            IndexName: gsiName,
            KeyConditionExpression: "#dow = :dowValue AND #sd < :endOfTomorrow",
            ExpressionAttributeNames: {
                "#dow": dow,
                "#sd": "sd"
            },
            ExpressionAttributeValues: {
                ":dowValue": 1,
                ":endOfTomorrow": endOfTomorrowUnix
            }
        };


        try {
            const config = { region: "us-east-1" };
            const client = new SchedulerClient(config);
            const data = await dynamodb.query(params).promise();

            for (const itm of data.Items) {
                const stUnix = itm.sd + itm.st;   // ✓ use fields directly
                const etUnix = itm.sd + itm.et;

                const startTime = moment(stUnix * 1000);
                const endTime = moment(etUnix * 1000);

                while (startTime <= endTime) {

                    var hour = startTime.format('HH');
                    var minute = startTime.format('mm');
                    const hourFormatted = hour.toString().padStart(2, '0');
                    const minuteFormatted = minute.toString().padStart(2, '0');

                    const scheduleName = `${hourFormatted}${minuteFormatted}`;

                    const scheduleExpression = `cron(${minuteFormatted} ${hourFormatted} * * ? *)`;

                    const input = {
                        Name: scheduleName,
                        GroupName: "runLambda",
                        ScheduleExpression: scheduleExpression,
                        ScheduleExpressionTimezone: "UTC",
                        StartDate: new Date(moment.utc().format()),
                        EndDate: new Date("2030-01-01T00:00:00Z"),
                        State: "ENABLED",
                        Target: {
                            Arn: "arn:aws:lambda:us-east-1:536814921035:function:compute-ComputeFunction-o6ASOYachTSp",
                            RoleArn: "arn:aws:iam::536814921035:role/service-role/Amazon_EventBridge_Scheduler_LAMBDA_306508827d",
                            Input: JSON.stringify({ "disable": true, "automate": true }),
                        },
                        FlexibleTimeWindow: { Mode: "OFF" },
                    };
                    const command = new UpdateScheduleCommand(input);

                    const createSchedule = async () => {
                        try {
                            const response = await client.send(command);

                            const params = {
                                TableName: "enabled",
                                Key: {
                                    "time": scheduleName,
                                },
                                UpdateExpression: "set #enabled = :enabled, #en = :en",
                                ExpressionAttributeNames: {
                                    "#enabled": "enabled",
                                    "#en": "en"
                                },
                                ExpressionAttributeValues: {
                                    ":enabled": 1,
                                    ":en": en
                                },
                                ReturnValues: "UPDATED_NEW"
                            };

                            try {
                                const result = await dynamodb.update(params).promise();
                            } catch (err) {
                                //console.error(`Error updating item with time: ${scheduleName}`, err);
                            }

                        } catch (error) {
                            console.error("Error creating schedule:", error);
                        }
                    };

                    await createSchedule();
                    startTime.add(data.Items[item].it, 'minutes');
                }
            }

        } catch (err) {
            console.error("Unable to query. Error:", JSON.stringify(err, null, 2));
        }

    }
    if (event.disable) {
        let enParams = { TableName: 'enCounter', KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': "enCounter" } };
        let en = await dynamodb.query(enParams).promise()
        let params = { TableName: 'enabled', IndexName: 'enabledindex', KeyConditionExpression: 'enabled = :enabled AND en = :en', ExpressionAttributeValues: { ':en': en.Items[0].x - 1, ':enabled': 1 } }
        const config = { region: "us-east-1" };
        const client = new SchedulerClient(config);

        await dynamodb.query(params).promise()
            .then(async data => {
                let updatePromises = data.Items.map(async item => {
                    const time = item.time
                    let updateParams = {
                        TableName: 'enabled',
                        Key: {
                            "time": item.time
                        },
                        UpdateExpression: 'SET enabled = :newEnabled, en = :en',
                        ExpressionAttributeValues: {
                            ':newEnabled': 0,
                            ':en': item.en
                        }
                    };

                    await dynamodb.update(updateParams).promise();
                    var hour = time.substring(0, 2);
                    var minute = time.substring(2, 4);
                    const hourFormatted = hour.toString().padStart(2, '0');
                    const minuteFormatted = minute.toString().padStart(2, '0');

                    const scheduleName = `${hourFormatted}${minuteFormatted}`;

                    const scheduleExpression = `cron(${minuteFormatted} ${hourFormatted} * * ? *)`;

                    const input = {
                        Name: scheduleName,
                        GroupName: "runLambda",
                        ScheduleExpression: scheduleExpression,
                        ScheduleExpressionTimezone: "UTC",
                        StartDate: new Date(moment.utc().format()),
                        EndDate: new Date("2030-01-01T00:00:00Z"),
                        State: "DISABLED",
                        Target: {
                            Arn: "arn:aws:lambda:us-east-1:536814921035:function:compute-ComputeFunction-o6ASOYachTSp",
                            RoleArn: "arn:aws:iam::536814921035:role/service-role/Amazon_EventBridge_Scheduler_LAMBDA_306508827d",
                            Input: JSON.stringify({ "automate": true }),
                        },
                        FlexibleTimeWindow: { Mode: "OFF" },
                    };

                    const command = new UpdateScheduleCommand(input);
                    const response = await client.send(command);
                    return "done"
                });

                return await Promise.all(updatePromises);
            })
            .then(updateResults => {
                //console.log('Update completed', updateResults);
            })
            .catch(error => {
                console.error('Error updating items', error);
            });
    } else {
        return serverlessHandler(event, context);
    }
};

module.exports = {
    lambdaHandler,
    runApp
};