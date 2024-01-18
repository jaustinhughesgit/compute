var express = require('express');
const serverless = require('serverless-http');
const AWS = require('aws-sdk');
const app = express();
const path = require('path');
const session = require('express-session');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

app.use(session({secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true, cookie: { secure: true }}));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
AWS.config.update({ region: 'us-east-1' });
dynamodbLL = new AWS.DynamoDB();
dynamodb = new AWS.DynamoDB.DocumentClient();
SM = new AWS.SecretsManager();
s3 = new AWS.S3();

var cookiesRouter;
var controllerRouter = require('./routes/controller')(dynamodb, dynamodbLL, uuidv4);
var indexRouter = require('./routes/index');

app.use('/controller', controllerRouter);

app.use('/', indexRouter);

app.use(async (req, res, next) => {
    if (!cookiesRouter) {
        try {
            const privateKey = await getPrivateKey();
            let {setupRouter, getSub} = require('./routes/cookies')
            cookiesRouter = setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3);
            app.use('/:type(cookies|url)*', function(req, res, next) {
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

app.all('/auth/*', 
    async (req, res, next) => {
        req.lib = {}
        req.lib.modules = {};
        req.lib.middlewareCache = []
        req.lib.isMiddlewareInitialized = false;
        req.lib.whileLimit = 100;
        req.lib.root = {}
        req.lib.root.context = {}
        req.lib.root.context.session = session
        next();
    },
    async (req, res, next) => {
        if (!req.lib.isMiddlewareInitialized && req.path.startsWith('/auth')) {
            req.lib.middlewareCache = await initializeMiddleware(req, res, next);
            req.lib.isMiddlewareInitialized = true;
        }
        next();
    },
    async (req, res, next) => {
        if (req.lib.middlewareCache.length > 0) {
            const runMiddleware = (index) => {
                if (index < req.lib.middlewareCache.length) {
                    req.lib.middlewareCache[index](req, res, () => runMiddleware(index + 1));
                } else {
                    //next();
                }
            };
            await runMiddleware(0);
        } else {
            //next();
        }
    }
);

async function getPrivateKey() {
    const secretName = "public/1var/s3";
    try {
        const data = await SM.getSecretValue({ SecretId: secretName }).promise();
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
    const data = await s3.getObject(params).promise();
    return await JSON.parse(data.Body.toString());
}

async function processConfig(config, initialContext, lib) {
    const context = { ...initialContext };
    for (const [key, value] of Object.entries(config.modules, context)) {
        let newPath = await installModule(value, key, context, lib);
    }
    return context;
}

async function installModule(moduleName, contextKey, context, lib) {
    const npmConfigArgs = Object.entries({cache: '/tmp/.npm-cache',prefix: '/tmp',}).map(([key, value]) => `--${key}=${value}`).join(' ');
    await exec(`npm install ${moduleName} ${npmConfigArgs}`); 
    lib.modules[moduleName] = moduleName
    if (!context.hasOwnProperty(contextKey)){
        context[contextKey] = {"value":{}, "context":{}}
    }
    context[contextKey].value = await require("/tmp/node_modules/"+moduleName);
    return "/tmp/node_modules/"+moduleName
}

async function initializeMiddleware(req, res, next) {
    if (req.path.startsWith('/auth')) {
        let {setupRouter, getHead, convertToJSON} = await require('./routes/cookies')
        const head = await getHead("su", req.path.split("/")[2].split("?")[0], dynamodb)
        const parent = await convertToJSON(head.Items[0].su, [], null, null, dynamodb, uuidv4)
        let fileArray = parent.paths[req.path.split("/")[2].split("?")[0]];
        const promises = await fileArray.map(async fileName => await retrieveAndParseJSON(fileName));
        const results = await Promise.all(promises);
        const arrayOfJSON = [];
        results.forEach(result => arrayOfJSON.push(result));
        let resultArrayOfJSON = arrayOfJSON.map(async userJSON => {
            return async (req, res, next) => {
                req.lib.root.context = await processConfig(userJSON, req.lib.root.context, req.lib);
                req.lib.root.context["urlpath"] = {"value":req.path.split("?")[0], "context":{}}
                req.lib.root.context["sessionID"] = {"value":req.sessionID, "context":{}}
                req.lib.root.context.req = {"value":req, "context":{}}
                req.lib.root.context.res = {"value":res, "context":{}}
                await initializeModules(req.lib, userJSON, req, res, next);
            };
        });
        return await Promise.all(resultArrayOfJSON)
    }
}

async function initializeModules(libs, config, req, res, next) {
    await require('module').Module._initPaths();
    for (const action of config.actions) {
        let runResponse = await runAction(action, libs, "root", req, res, next);
        if (runResponse == "contune"){
            continue
        }
    }
}

async function getNestedContext(libs, nestedPath) {
    const parts = nestedPath.split('.');
    if (nestedPath && nestedPath != ""){
        let tempContext = libs;
        let partCounter = 0
        for (let part of parts) {
                tempContext = tempContext[part].context;
        }
        return tempContext;
    }
    return libs
}

async function getNestedValue(libs, nestedPath) {
    const parts = nestedPath.split('.');
    if (nestedPath && nestedPath != ""){
        let tempContext = libs;
        let partCounter = 0
        for (let part of parts) {
            if (partCounter < parts.length-1 || partCounter == 0){
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
    //need an updated condition for if left is the only argument then return it's value (bool or truthy)

    if (!Array.isArray(conditions)) {
        conditions = [{ condition: conditions, right: right }];
    }

    return await conditions.reduce(async (result, cond) => {
        const currentResult = await checkCondition(left, cond.condition, cond.right, libs, nestedPath);
        if (operator === "&&") {
            return result && currentResult;
        } else if (operator === "||") {
            return result || currentResult;
        } else {
            //console.log("Invalid operator");
        }
    }, operator === "&&");
}

async function checkCondition(left, condition, right, libs, nestedPath) {
    left = await replacePlaceholders(left, libs, nestedPath)
    right = await replacePlaceholders(right, libs, nestedPath)
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

async function replacePlaceholders(item, libs, nestedPath) {
    let processedItem = item;
    if (typeof processedItem === 'string') {
        let stringResponse = await processString(processedItem, libs, nestedPath);
        return stringResponse;
    } else if (Array.isArray(processedItem)) {
        let newProcessedItem2 =  processedItem.map(async element => {
            console.log("element", element)
            let repHolder = await replacePlaceholders(element, libs, nestedPath)
            console.log("repHolder", repHolder)
            return repHolder
        });
        return await Promise.all(newProcessedItem2);
    } else {
        return item
    }
    
}

async function isOnePlaceholder(str) {
    if (str.startsWith("{{") && (str.endsWith("}}") || str.endsWith("}}!"))) {
        return str.indexOf("{{", 2) === -1;
    }
    return false;
}

async function removeBrackets(str, isObj, isExecuted){
    return isObj ? str.slice(2, isExecuted ? -3 : -2) : str
}

async function getKeyAndPath(str, nestedPath){
    let val = str.split(".");

    let key = str;
    let path = "";
    if (str.startsWith("~/")){
        val[0] = val[0].replace("~/", "")
        val.unshift("root")
    }
    if (val.length > 1){
        key = val[val.length-1]
        path = val.slice(0, -1)
        path = path.join(".")
    }
    if (nestedPath != "" && !str.startsWith("~/")){
        path = nestedPath + "." + path
    } else {
        path = path
    }
    if (path.endsWith(".")){
        path = path.slice(0,-1)
    } 
    return {"key":key, "path":path}
}

function getValueFromPath(obj, path) {
    return path.split('.').reduce((current, key) => {
        // Traverse using 'context' key and then get the 'value'
        return current && current && current[key] ? current[key] : null;
    }, obj);
}

async function processString(str, libs, nestedPath) {
    const isExecuted = str.endsWith('}}!');
    const isObj = await isOnePlaceholder(str)
    let strClean = await removeBrackets(str, isObj, isExecuted);
    let arrowJson = strClean.split("=>")
    strClean = arrowJson[0]
    console.log("strClean", strClean, str)
    let target = await getKeyAndPath(strClean, nestedPath)
    let nestedContext = await getNestedContext(libs, target.path)
    let nestedValue= await getNestedValue(libs, target.path)

    if (nestedContext.hasOwnProperty(target.key)){
        let value = nestedContext[target.key].value
        if (arrowJson.length > 1){
            value = getValueFromPath(value, arrowJson[1]);
        }
        if (typeof value === 'function') {
            if (isExecuted){
            value = await value();
            }
        }
        return value
    }
    return str
}

async function runAction(action, libs, nestedPath, req, res, next){
    if (action != undefined){
        let runAction = true;
        //DON'T FORGET TO UPDATE JSON TO NOT INCLUDE THE S IN IF !!!!!!!!!!!!!!!!!!
        if (action.if) {
            for (const ifObject of action.if) {
                runAction = await condition(ifObject[0], ifObject[1], ifObject[2], ifObject[3], libs, nestedPath);
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
                    while (condition(await replacePlaceholders(whileCondition[0], libs, nestedPath), [{ condition: whileCondition[1], right: await replacePlaceholders(whileCondition[2], libs, nestedPath) }], null, "&&", libs, nestedPath)) {
                        await processAction(action, libs, nestedPath, req, res, next);
                        whileChecker++;
                        if (whileCounter >= whileLimit){
                            break;
                        }
                    }
                }
            }

            if (!action.while){
                await processAction(action, libs, nestedPath, req, res, next);
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

async function addValueToNestedKey(key, nestedContext, value){
    if (value == undefined || key == undefined){
        //console.log("key/value undefined")
    } else {
        if (!nestedContext.hasOwnProperty(key)){
            nestedContext[key] = {"value":{}, "context":{}}
        }
        nestedContext[key].value = value;
    }
}

async function processAction(action, libs, nestedPath, req, res, next) {
    if (action.set) {
        for (const key in action.set) {
            let set = await getKeyAndPath(key, nestedPath);
            let nestedContext = await getNestedContext(libs, set.path);
            let value = await replacePlaceholders(action.set[key], libs, nestedPath)
            await addValueToNestedKey(set.key, nestedContext, value);
        }
    }

    if (action.target) {

        const isObj = await isOnePlaceholder(action.target)
        let strClean = await removeBrackets(action.target, isObj, false);

        let target = await getKeyAndPath(strClean, nestedPath);
        let nestedContext = await getNestedContext(libs, target.path);

        if (!nestedContext.hasOwnProperty(target.key)){
            nestedContext[target.key] = {"value":{}, "context":{}}
        }

        value = await replacePlaceholders(target.key, libs, target.path);
        let args = [];

        // IS THERE A MORE INDUSTRY STANDARD TERM THAN THE WORD "FROM" THAT LLM WOULD UNDERSTAND BETTER?
        if (value){
            if (action.from) {
                args = await action.from.map(async item => {
                    const fromExecuted = item.endsWith('}}!');
                    const fromObj = await isOnePlaceholder(item);
                    let value = await replacePlaceholders(item, libs, nestedPath);
                    if (fromObj && fromExecuted && typeof value === 'function') {
                        return value();
                    }
                    return value;
                });
                await Promise.all(args)
            }

            if (typeof nestedContext[target.key].value === 'function' && args.length > 0) {
                nestedContext[target.key].value = value(...args); 
            }
        }
        let newNestedPath = nestedPath
        result = await applyMethodChain(value, action, libs, newNestedPath, res, req, next);
        if (action.assign) {
            const assignExecuted = action.assign.endsWith('}}!');
            console.log("assignExecuted",assignExecuted, action.assign)
            const assignObj = await isOnePlaceholder(action.assign);
            console.log("assignObj",assignObj)
            let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
            console.log("strClean",strClean)

            let assign = await getKeyAndPath(strClean, nestedPath);
            console.log("assign", assign)
            let nestedContext = await getNestedContext(libs, assign.path);
            console.log("nestedContext", nestedContext)
            if (assignObj && assignExecuted && typeof result === 'function') {
                console.log("inside", result)
                let tempFunction = () => result;
                let newResult = await tempFunction()
                await addValueToNestedKey(strClean, nestedContext, newResult)
            } else {
                console.log("other", assign)
                await addValueToNestedKey(strClean, nestedContext, result)
                //console.log("if", typeof nestedContext[assign.target], assignExecuted)
                //if (typeof nestedContext[assign.target] === "function" && assignExecuted){
                //    nestedContext[assign.target](...args)
                //}
            }
        }
    } else if (action.assign && action.params) {
        const assignExecuted = action.assign.endsWith('}}!');
        const assignObj = await isOnePlaceholder(action.assign);
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        let assign = await getKeyAndPath(strClean, nestedPath);
        let nestedContext = await getNestedContext(libs, assign.path);
        if (assignObj) {
            let result = await createFunctionFromAction(action, libs, assign.path, req, res, next)
            if (assignExecuted && typeof result === 'function'){
                    result = await result()
            } else if (typeof result === 'function'){
                    result = JSON.stringify(result);
            }
            await addValueToNestedKey(assign.key, nestedContext, result);
        } else {
            await addValueToNestedKey(action.assign, nestedContext, await createFunctionFromAction(action, libs, assign.path, req, res, next));
        }
    } 

    if (action.execute) {
        const isObj = await isOnePlaceholder(action.execute)
        let strClean = await removeBrackets(action.execute, isObj, false);//false but will be executed below
        let execute = await getKeyAndPath(strClean, nestedPath);
        let nestedContext = await getNestedContext(libs, execute.path);
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

async function applyMethodChain(target, action, libs, nestedPath, res, req, next) {
    let result = target

    if (nestedPath.endsWith(".")){
        nestedPath = nestedPath.slice(0,-1)
    }

    if (nestedPath.startsWith(".")){
        nestedPath = nestedPath.slice(1)
    }

    async function instantiateWithNew(constructor, args) {
        return await new constructor(...args);
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
                chainParams = await replacePlaceholders(chainAction.params, libs, nestedPath)
            } else {
                chainParams = [];
            }

            let accessClean = chainAction.access
            if (accessClean){
                const isObj = await isOnePlaceholder(accessClean)
                accessClean = await removeBrackets(accessClean, isObj, false);
            }

            if (accessClean && !chainAction.params) {
                result = result[accessClean];
            } else if (accessClean && chainAction.new && chainAction.params) {
                result = await instantiateWithNew(result[accessClean], chainParams);
            } else if (typeof result[accessClean] === 'function') {
                if (accessClean === 'promise') {
                    result = await result.promise();
                } else {
                    if (chainAction.new) {
                        result = new result[accessClean](...chainParams);
                    } else {
                        if (chainAction.access && accessClean.length != 0){
                            if (chainAction.express){
                                if (chainAction.next || chainAction.next == undefined){
                                    result = await result[accessClean](...chainParams)(req, res, next);
                                } else {
                                    result = await result[accessClean](...chainParams)(req, res);
                                }
                            } else {
                                try{
                                result = await result[accessClean](...chainParams);
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

async function createFunctionFromAction(action, libs, nestedPath, req, res, next) {
    console.log("11111111")
    return  async function (...args) {
        const assignExecuted = action.assign.endsWith('}}!');
        const assignObj = await isOnePlaceholder(action.assign);
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        let assign = await getKeyAndPath(strClean, nestedPath);
        let nestedContext = await getNestedContext(libs, assign.path);
        let result;
        console.log("args", args)
        let addToNested = await args.reduce(async (unusedObj, arg, index) => {
            console.log("arg", arg)
            if (action.params && action.params[index]) {
                const paramExecuted = action.params[index].endsWith('}}!');
                const paramObj = await isOnePlaceholder(action.params[index]);
                let paramClean = await removeBrackets(action.params[index], paramObj, paramExecuted);
                let param = await getKeyAndPath(paramClean, nestedPath);
                let paramNestedContext = await getNestedContext(libs, param.path);
                if (paramExecuted && paramObj && typeof arg === "function"){
                    paramNestedContext[param.value] = await arg();
                } else {
                    paramNestedContext[param.value] = arg;
                }
            }
        }, nestedContext);

        if (action.params){
            for (par in action.params){
                let param = action.params[par]
                if (param != null && param != null && param != ""){
                    const paramExecuted = param.endsWith('}}!');
                    const paramObj = await isOnePlaceholder(param);
                    let paramClean2 = await removeBrackets(param, paramObj, paramExecuted);
                    let newNestedPath = nestedPath+"."+assign.key
                    let p = await getKeyAndPath(paramClean2, newNestedPath);
                    let nestedParamContext = await getNestedContext(libs, p.path);
                    console.log("addValue:",paramClean2, nestedParamContext)
                    await addValueToNestedKey(paramClean2, nestedParamContext, {})
                    console.log("lib.root.context", libs.root.context)
                }
            }
        }
        console.log("222222")
        console.log("lib.root.context", libs.root.context)
        if (action.run) {
            for (const act of action.run) {
                let newNestedPath = nestedPath+"."+assign.key
                let newNestedContext = await getNestedContext(libs, newNestedPath);
                result = await runAction(act, libs, newNestedPath, req, res, next)
            }
        }
        return result;
    };
}

module.exports.lambdaHandler = serverless(app);