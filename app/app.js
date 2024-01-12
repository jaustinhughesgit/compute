var express = require('express');
const serverless = require('serverless-http');
// SEE IF WE CAN INCORPORATE LIB INTO EACH INITIAL WEB CALL SO IT'S NOT EXPOSED TO OTHER USERS WHO USE THE INVOKE!!!!!!!!!!!!!!!!!!!!!
let lib = {};
lib.modules = {};
lib.AWS = require('aws-sdk');
lib.app = express();
lib.path = require('path');
lib.root = {}
lib.process = process
lib.root.session = require('express-session');
lib.fs = require('fs');
const { v4: uuidv4 } = require('uuid');
lib.uuidv4 = uuidv4
const { promisify } = require('util');
lib.exec = promisify(require('child_process').exec);
lib.app.use(lib.root.session({secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true, cookie: { secure: true }}));
lib.app.set('views', lib.path.join(__dirname, 'views'));
lib.app.set('view engine', 'ejs');
lib.AWS.config.update({ region: 'us-east-1' });
lib.dynamodbLL = new lib.AWS.DynamoDB();
lib.dynamodb = new lib.AWS.DynamoDB.DocumentClient();
lib.SM = new lib.AWS.SecretsManager();
lib.s3 = new lib.AWS.S3();
let isMiddlewareInitialized = false;
let middlewareCache = [];
let whileLimit = 100;
var cookiesRouter;
var controllerRouter = require('./routes/controller')(lib.dynamodb, lib.dynamodbLL, lib.uuidv4);
var indexRouter = require('./routes/index');

lib.app.use('/controller', controllerRouter);

lib.app.use('/', indexRouter);

lib.app.use(async (req, res, next) => {
    if (!cookiesRouter) {
        try {
            const privateKey = await getPrivateKey();
            let {setupRouter, getSub} = require('./routes/cookies')
            cookiesRouter = setupRouter(privateKey, lib.dynamodb, lib.dynamodbLL, lib.uuidv4, lib.s3);
            lib.app.use('/:type(cookies|url)*', function(req, res, next) {
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

lib.app.use(async (req, res, next) => {
    if (!isMiddlewareInitialized && req.path.startsWith('/auth')) {
        middlewareCache = await initializeMiddleware(req, res, next);
        isMiddlewareInitialized = true;
    }
    next();
});

lib.app.all('/auth/*', (req, res, next) => {
    if (middlewareCache.length > 0) {
        const runMiddleware = (index) => {
            if (index < middlewareCache.length) {
                middlewareCache[index](req, res, () => runMiddleware(index + 1));
            } else {
                next();
            }
        };
        runMiddleware(0);
    } else {
        next();
    }
});

async function getPrivateKey() {
    const secretName = "public/1var/s3";
    try {
        const data = await lib.SM.getSecretValue({ SecretId: secretName }).promise();
        const secret = JSON.parse(data.SecretString);
        let pKey = JSON.stringify(secret.privateKey).replace(/###/g, "\n").replace('"','').replace('"','');
        return pKey
    } catch (error) {
        console.error("Error fetching secret:", error);
        throw error;
    }
}

async function retrieveAndParseJSON(fileName) {
    const params = { Bucket: 'public.1var.com', Key: 'actions/'+fileName+'.json'};
    const data = await lib.s3.getObject(params).promise();
    return JSON.parse(data.Body.toString());
}

async function processConfig(config, initialContext, lib) {
    const context = { ...initialContext };
    for (const [key, value] of Object.entries(config.modules, context)) {

        let newPath = await installModule(value, context, lib);
    }
    return context;
}

async function installModule(moduleName, context, lib) {
    const npmConfigArgs = Object.entries({cache: '/tmp/.npm-cache',prefix: '/tmp',}).map(([key, value]) => `--${key}=${value}`).join(' ');
    await lib.exec(`npm install ${moduleName} ${npmConfigArgs}`); 
    lib.modules[moduleName] = moduleName
    return "/tmp/node_modules/"+moduleName
}

async function initializeMiddleware(req, res, next) {
    //maybe we don't need res or next. delete them later and check!
    if (req.path.startsWith('/auth')) {
        let {setupRouter, getHead, convertToJSON} = require('./routes/cookies')
        const head = await getHead("su", req.path.split("/")[2].split("?")[0], lib.dynamodb)
        const parent = await convertToJSON(head.Items[0].su, [], null, null, lib.dynamodb)
        let fileArray = parent.paths[req.path.split("/")[2].split("?")[0]];
        const promises = await fileArray.map(fileName => retrieveAndParseJSON(fileName));
        const results = await Promise.all(promises);
        const arrayOfJSON = [];
        await results.forEach(result => arrayOfJSON.push(result));
        return arrayOfJSON.map(userJSON => {
            return async (req, res, next) => {
                lib.context = await processConfig(userJSON, lib.context, lib);
                lib.context["urlpath"] = req.path.split("?")[0];
                lib.context["sessionID"] = req.sessionID;
                await initializeModules(lib.context, userJSON, req, res, next);
            };
        });
    }
}

async function initializeModules(context, config, req, res, next) {
    require('module').Module._initPaths();
    for (const action of config.actions) {
        let runResponse = await runAction(action, context, "",req, res, next);
        if (runResponse == "contune"){
            continue
        }
    }
}

function getNestedContext(context, nestedPath) {
    const parts = nestedPath.split('.');
    console.log("parts",parts)
    if (nestedPath && nestedPath != ""){
        let tempContext = context;
        console.log("tempContext:before",tempContext)
        let partCounter = 0
        for (let part of parts) {
            console.log("partCounter", partCounter, "parts.length()", parts.length)
            if (partCounter < parts.length-1){ //skips last path
                console.log("part", part, parts)
                console.log("tempContext[part]",tempContext[part])
                if (tempContext[part] === undefined || !(tempContext[part] instanceof Object)) {
                    tempContext[part] = {"value":{}, "context":{}};
                }
                console.log("END1:", tempContext[part])
                console.log("END2:", tempContext[part].context)
                tempContext = tempContext[part];
            }
        }
        console.log("RETURN")
        console.log("tempContext:after", tempContext)
        return tempContext;
    }
    console.log("RETURN ELSE")

    return context
}

async function condition(left, conditions, right, operator = "&&", context, nestedPath) {
    //need an updated condition for if left is the only argument then return it's value (bool or truthy)

    if (!Array.isArray(conditions)) {
        conditions = [{ condition: conditions, right: right }];
    }

    return await conditions.reduce(async (result, cond) => {
        const currentResult = await checkCondition(left, cond.condition, cond.right, context, nestedPath);
        if (operator === "&&") {
            return result && currentResult;
        } else if (operator === "||") {
            return result || currentResult;
        } else {
            console.log("Invalid operator");
        }
    }, operator === "&&");
}

async function checkCondition(left, condition, right, context, nestedPath) {
    left = await replacePlaceholders(left, context, nestedPath)
    right = await replacePlaceholders(right, context, nestedPath)
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

async function replacePlaceholders(item, context, nestedPath) {
    console.log("replacePlaceholders", item, context, nestedPath) 
    let processedItem = item;
    if (typeof processedItem === 'string') {
        console.log("string")
        processedItem = await processString(processedItem, context, nestedPath);
    } else if (Array.isArray(processedItem)) {
        processedItem =  processedItem.map(async element => await replacePlaceholders(element, context, nestedPath));
    }
    return processedItem;
}

function isOnePlaceholder(str) {
    if (str.startsWith("{{") && (str.endsWith("}}") || str.endsWith("}}!"))) {
        return str.indexOf("{{", 2) === -1;
    }
    return false;
}

function removeBrackets(str, isObj, isExecuted){
    return isObj ? str.slice(2, isExecuted ? -3 : -2) : str
}

function getKeyAndPath(str, nestedPath){
    let val = str.split(".");
    let key = str;
    let path = "";
    if (val.length > 1){
        key = val[val.length]
        path = str.slice(0, -1).join(".")
    }
    if (nestedPath != ""){
        path = nestedPath + "." + path
    }
    if (path.endsWith(".")){
        path = path.slice(0,-1)
    }
    return {key:key, path:path}
}
//"initialize", {"passport":[funciton]}, "passport"
async function processString(str, context, nestedPath) {
    console.log("processString", str, context, nestedPath)
    const isExecuted = str.endsWith('}}!');
    console.log("isExecuted",isExecuted)
    const isObj = isOnePlaceholder(str)
    console.log("isObj", isObj)
    let strClean = await removeBrackets(str, isObj, isExecuted);
    console.log("strClean", strClean)
    let target = getKeyAndPath(strClean, nestedPath)
    console.log("target", target)
    let nestedContext = await getNestedContext(context, target.path)
    console.log("nestedContext.hasOwnProperty(strClean)",nestedContext.hasOwnProperty(strClean))

    console.log("nestedContext",nestedContext)

    if (lib[str]) {
        console.log("3 lib", lib)
        console.log("4 str", str)
        return lib[str];
    }

    if (nestedContext.hasOwnProperty(target.key)){
        let value = nestedContext[target.key].value
        return isExecuted ? await value() : value
    }

    if (isObj && nestedPath == "../" && lib.hasOwnProperty(target.key)){
        let value = lib[target.key].value
        return isExecuted ? await value() : value
    }

    console.log("lib.modules", lib.modules)
    console.log("target.key", target.key)
    console.log("hasOwnProperty", lib.modules.hasOwnProperty(target.key))

    // IN THE OLD V0.6 IT HAS CONDITIONS FOR LIB.MODULES.HASOWNPROPERTY. WE CAN USE THIS HERE INSTEAD.

    try {    
        if (!nestedContext.hasOwnProperty(strClean)){
            nestedContext[strClean] = {"value":{}, "context":{}}
        }
        console.log("7 resolve", require.resolve("/tmp/node_modules/"+target.key))
        if (require.resolve("/tmp/node_modules/"+target.key)) {
            console.log("8 /tmp/node_modules/"+target.key)
            return await require("/tmp/node_modules/"+target.key);
        }
    } catch (e) {
        console.error(`Module '${str}' cannot be resolved:`, e);
    }

    if (!isObj){
        return str.replace(/\{\{([^}]+)\}\}/g, async (match, keyPath) => {
            let target = getKeyAndPath(keyPath, nestedPath)
            let value = await getNestedContext(context, target.path)?.[target.key].value;
            return value !== undefined ? value : match; 
        });
    }
}

async function runAction(action, context, nestedPath, req, res, next){
    if (action != undefined){
        let runAction = true;
        //DON'T FORGET TO UPDATE JSON TO NOT INCLUDE THE S IN IF !!!!!!!!!!!!!!!!!!
        if (action.if) {
            for (const ifObject of action.if) {
                runAction = await condition(ifObject[0], ifObject[1], ifObject[2], ifObject[3], context, nestedPath);
                if (!runAction) {
                    break;
                }
            }
        }

        if (runAction) {
            //DON"T FORGET TO UPDATE JSON TO NOT INCLUDE S IN WHILE !!!!!!!!!!!!!!!!!!!!
            if (action.while) {
                let whileCounter = 0
                for (const whileCondition of action.while) {
                    while (condition(await replacePlaceholders(whileCondition[0], context, nestedPath), [{ condition: whileCondition[1], right: await replacePlaceholders(whileCondition[2], context, nestedPath) }], null, "&&", context, nestedPath)) {
                        await processAction(action, context, nestedPath, req, res, next);
                        whileChecker++;
                        if (whileCounter >= whileLimit){
                            break;
                        }
                    }
                }
            }

            if (!action.while){
                await processAction(action, context, nestedPath, req, res, next);
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

function addValueToNestedKey(key, nestedContext, value){
    nestedContext[key].value = value;
}

async function processAction(action, context, nestedPath, req, res, next) {

    if (action.set) {
        for (const key in action.set) {
            let set = getKeyAndPath(key, nestedPath);
            let nestedContext = getNestedContext(context, set.path);
            addValueToNestedKey(set.key, nestedContext, replacePlaceholders(action.set[key], context, nestedPath));
        }
    }

    if (action.target) {
        //let moduleInstance = await replacePlaceholders(action.target, context, nestedPath);
        //console.log("moduleInstance", moduleInstance)

        console.log("PA:action.target", action.target)
        const isObj = isOnePlaceholder(action.target)
        console.log("PS:isObj", isObj)
        let strClean = await removeBrackets(action.target, isObj, false);
        console.log("PA:strClean", strClean)
        let target = getKeyAndPath(strClean, nestedPath);
        console.log("PA:target", target)
        let nestedContext = await getNestedContext(context, target.path);
        console.log("PA:nestedContext", nestedContext)
        let value = await replacePlaceholders(target.key, context, nestedPath);
        let args = [];

        // IS THERE A MORE INDUSTRY STANDARD TERM THAN THE WORD "FROM" THAT LLM WOULD UNDERSTAND BETTER?
        if (value){
            if (action.from) {
                args = await action.from.map(async item => {
                    console.log("map:item", item)
                    const fromExecuted = item.endsWith('}}!');
                    const fromObj = isOnePlaceholder(item);
                    let value = await replacePlaceholders(item, context, nestedPath);
                    if (fromObj && fromExecuted && typeof value === 'function') {
                        return value();
                    }
                    return value;
                });
            }

            if (typeof value === 'function' && args.length > 0) {
                 value = value(...args); 
            }
        }

        nestedContext[target.key].value = value
        result = await applyMethodChain(nestedContext[target.key].value, action, context, nestedPath, res, req, next);
        console.log("result:After", result)
        if (action.assign) {
            const assignExecuted = action.assign.endsWith('}}!');
            console.log("assignExecuted", assignExecuted)
            const assignObj = isOnePlaceholder(action.assign);
            console.log("assignObj", assignObj)
            let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
            console.log("strClean", strClean)
            let assign = getKeyAndPath(strClean, nestedPath);
            console.log("assign", assign)
            console.log("context/assign.path", context, assign.path)
            let nestedContext = await getNestedContext(context, assign.path);
            console.log("nestedContext",nestedContext)
            if (assignObj && assignExecuted && typeof result === 'function') {
                let tempFunction = () => result;
                let newResult = await tempFunction()
                addValueToNestedKey(action.assign, nestedContext, newResult)
            } else {
                addValueToNestedKey(action.assign, nestedContext, result)
            }
        }
    } else if (action.assign && action.params) {
        const assignExecuted = action.assign.endsWith('}}!');
        const assignObj = isOnePlaceholder(action.assign);
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        let assign = getKeyAndPath(strClean, nestedPath);
        let nestedContext = await getNestedContext(context, assign.path);

        if (assignObj) {
            let result = await createFunctionFromAction(action, context, nestedContext, req, res, next)

            if (assignExecuted && typeof result === 'function'){
                    result = result()
            } else if (typeof result === 'function'){
                    result = JSON.stringify(result);
            }
            addValueToNestedKey(assign.key, nestedContext, result);
        } else {
            addValueToNestedKey(action.assign, nestedContext, await createFunctionFromAction(action, context, nestedContext, req, res, next));
        }
    } 

    if (action.execute) {
        const isObj = isOnePlaceholder(action.execute)
        let strClean = await removeBrackets(action.execute, isObj, false);//false but will be executed below
        let execute = getKeyAndPath(strClean, nestedPath);
        let nestedContext = await getNestedContext(context, execute.path);
        let value = nestedContext[execute.value]
        // LOOK INTO ACTION.NEXT = FALSE. IS THIS POSSIBLE IN ACTION LIKE IN CHAIN.
        if (typeof value === 'function') {
            if (action.express) {
                if (!action.next){
                    await value.value(req, res);
                } else {
                    await value.value(req, res, next); 
                }
            } else {
                await value.value;
            }
        } else {
            console.error(`No function named ${functionName} found in context`);
        }
    }
    
    if (action.next) {
        next();
    }
}

async function applyMethodChain(result, action, context, nestedPath, res, req, next) {
    console.log("applyMethodChain",target, action, context, nestedPath)
    if (nestedPath == "") {
        nestedPath = action.target
    } else {
        nestedPath += "." + action.target
    }
    if (nestedPath.endsWith(".")){
        nestedPath = nestedPath.slice(0,-1)
    }
    console.log("typeof result", typeof result)
    function instantiateWithNew(constructor, args) {
        return new constructor(...args);
    }
    // DELETED (here) the action.access condition that avoided action.chain by putting everything in the action, so that we had less to prompt engineer for LLM.

    if (action.chain && result) {
        for (const chainAction of action.chain) {
            let chainParams;

            // I FORGOT ABOUT THIS RETURN CAPABILITY. IT RETURNS WHAT THE "VALUE" OF WHAT CHAINACTION.RETURN HOLDS. 
            if (chainAction.hasOwnProperty('return')) {
                return chainAction.return;
            }

            if (chainAction.params) {
                chainParams = await replacePlaceholders(chainAction.params, context, nestedPath)
            } else {
                chainParams = [];
            }

            let accessClean = chainAction.access
            if (accessClean){
                console.log("1")
                const isObj = isOnePlaceholder(accessClean)
                console.log("1:isObj", isObj)
                accessClean = await removeBrackets(accessClean, isObj, false);
                console.log("1:accessClean", accessClean)
            }
            if (accessClean && !chainAction.params) {
                result = result[accessClean];
            } else if (accessClean && chainAction.new && chainAction.params) {
                result = await instantiateWithNew(result[accessClean], chainParams);
            } else if (typeof result[accessClean] === 'function') {
                console.log("2")
                if (accessClean === 'promise') {
                    result = await result.promise();
                } else {
                    console.log("2.1")
                    if (chainAction.new) {
                        result = new result[accessClean](...chainParams);
                    } else {
                        console.log("2.2")
                        if (chainAction.access && accessClean.length != 0){
                            console.log("2.3")

                            //const methodFunction = await replacePlaceholders(accessClean, context, nestedPath)
                            //console.log("methodFunction", methodFunction)
                            //let nestedContext = await getNestedContext(context, nestedPath);
                            //console.log("new nestedContext", nestedContext)
                            //nestedContext[action.target].value[accessClean].value = methodFunction
                            //console.log("new2 nestedContext", nestedContext)
                            if (chainAction.express){
                                console.log("2.4")
                                if (chainAction.next || chainAction.next == undefined){
                                    console.log("2.5")
                                        console.log("accessClean", accessClean)
                                        console.log("chainParams", chainParams)
                                        console.log("result", result)
                                        //Authenticator is not being returned with session here.
                                        result = result[accessClean](...chainParams)(req, res, next);
                                    console.log("result222", result)
                                } else {
                                        result = result[accessClean](...chainParams)(req, res);
                                }
                            } else {
                                try{
                                result = result[accessClean](...chainParams);
                                } catch(err){
                                    result = result
                                }
                            }
                        }
                    }
                }
            } else if (!accessClean && chainAction.params){
                // SEE IF WE CAN USE THIS FOR NO METHOD FUNCTIONS LIKE method()(param, param, pram)
            } else {
                console.error(`Method ${chainAction.access} is not a function on ${action.target}`);
                return;
            }
        }
    }
    return result;
}

function createFunctionFromAction(action, context, nestedContext, req, res, next) {
    console.log("----------")
    console.log("----------")
    console.log("----------")
    console.log("createFunctionFromAction", action, context, nestedContext)
    return async function(...args) {
        const assignExecuted = action.assign.endsWith('}}!');
        const assignObj = isOnePlaceholder(action.assign);
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        let assign = getKeyAndPath(strClean, nestedPath);
        let nestedContext = await getNestedContext(context, assign.path);
        let result;

        args.reduce(async (unusedObj, arg, index) => {
            if (action.params && action.params[index]) {
                const paramExecuted = action.params[index].endsWith('}}!');
                const paramObj = isOnePlaceholder(action.params[index]);
                let paramClean = await removeBrackets(action.params[index], paramObj, paramExecuted);
                let param = getKeyAndPath(paramClean, nestedPath);
                let nestedContext = await getNestedContext(context, param.path);
                console.log("cFFA nestedContext",nestedContext)
                console.log("cFFA paramExecuted",paramExecuted)
                console.log("cFFA param",param)
                if (paramExecuted && paramObj && typeof arg === "function"){
                    console.log("is a function")
                    nestedContext[param.value] = arg();
                } else {
                    console.log("is not a function", arg)
                    nestedContext[param.value] = arg;
                }
            }
        }, {});

        if (action.run) {
            for (const runAction of action.run) {
                result = await runAction(runAction, context, nestedContext, req, res, next)
            }
        }
        return result;
    };
}

module.exports.lambdaHandler = serverless(lib.app);