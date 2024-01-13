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
    console.log(req)
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
    await lib.exec(`npm install ${moduleName} ${npmConfigArgs}`); 
    lib.modules[moduleName] = moduleName
    if (!context.hasOwnProperty(contextKey)){
        context[contextKey] = {"value":{}, "context":{}}
    }
    context[contextKey].value = await require("/tmp/node_modules/"+moduleName);
    return "/tmp/node_modules/"+moduleName
}

async function initializeMiddleware(req, res, next) {
    //maybe we don't need res or next. delete them later and check!
    if (req.path.startsWith('/auth')) {
        let {setupRouter, getHead, convertToJSON} = await require('./routes/cookies')
        const head = await getHead("su", req.path.split("/")[2].split("?")[0], lib.dynamodb)
        const parent = await convertToJSON(head.Items[0].su, [], null, null, lib.dynamodb)
        let fileArray = parent.paths[req.path.split("/")[2].split("?")[0]];
        const promises = await fileArray.map(async fileName => await retrieveAndParseJSON(fileName));
        const results = await Promise.all(promises);
        const arrayOfJSON = [];
        results.forEach(result => arrayOfJSON.push(result));
        let resultArrayOfJSON = arrayOfJSON.map(async userJSON => {
            return async (req, res, next) => {
                lib.context = await processConfig(userJSON, lib.context, lib);
                lib.context["urlpath"] = {"value":req.path.split("?")[0], "context":{}}
                lib.context["sessionID"] = {"value":req.sessionID, "context":{}}
                await initializeModules(lib.context, userJSON, req, res, next);
            };
        });
        return await Promise.all(resultArrayOfJSON)
    }
}

async function initializeModules(context, config, req, res, next) {
    await require('module').Module._initPaths();
    for (const action of config.actions) {
        let runResponse = await runAction(action, context, "", req, res, next);
        if (runResponse == "contune"){
            continue
        }
    }
}

async function getNestedContext(context, nestedPath) {
    const parts = nestedPath.split('.');
    if (nestedPath && nestedPath != ""){
        let tempContext = context;
        let partCounter = 0
        for (let part of parts) {
            if (partCounter < parts.length-1){
                tempContext = tempContext[part].context;
            }
        }
        return tempContext;
    }
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
        return await processString(processedItem, context, nestedPath);
    } else if (Array.isArray(processedItem)) {
        console.log("processedItem", processedItem)
        let newProcessedItem2 =  processedItem.map(async element => {
            console.log("element", element, context, nestedPath)
            await replacePlaceholders(element, context, nestedPath)});
        return await Promise.all(newProcessedItem2);
    } else {
        console.log("not a string", processedItem)
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
    console.log("getKeyAndPath", str, nestedPath)
    let val = str.split(".");
    let key = str;
    let path = "";
    if (val.length > 1){
        key = val[val.length]
        path = str.slice(0, -1).join(".")
        console.log("$$$ path", path)
    }
    if (nestedPath != ""){
        console.log("$$$ nestedPath", nestedPath)
        path = nestedPath + "." + path
    }
    if (path.endsWith(".")){
        console.log("path ends with .")
        path = path.slice(0,-1)
    }
    return {"key":key, "path":path}
}

//"passport", {passport:{value:[funciton],context:{}}, ""
async function processString(str, context, nestedPath) {
    const isExecuted = str.endsWith('}}!');
    const isObj = await isOnePlaceholder(str)
    let strClean = await removeBrackets(str, isObj, isExecuted);
    console.log("******* nestedPath 1",nestedPath)
    let target = await getKeyAndPath(strClean, nestedPath)
    let nestedContext = await getNestedContext(context, target.path)
    console.log("222222222",nestedContext, target)
    if (nestedContext.hasOwnProperty(target.key)){
        let value = nestedContext[target.key].value
        console.log("value", value)
        console.log("typeof value", typeof value)
        if (typeof value === 'function') {
            console.log("running the function");
            value = await value();
        }
        if (Object.keys(value).length > 0 && value){
            return isExecuted ? await value() : value
        }
        return value
    }
    console.log("33333333")
    if (!isObj){
        return str.replace(/\{\{([^}]+)\}\}/g, async (match, keyPath) => {

            console.log("******* nestedPath 2",nestedPath)
            let target = await getKeyAndPath(keyPath, nestedPath)
            let value = await getNestedContext(context, target.path)?.[target.key].value;
            return value !== undefined ? value : match; 
        });
    }
}

async function runAction(action, context, nestedPath, req, res, next){
    console.log("runAction", action)
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

async function addValueToNestedKey(key, nestedContext, value){
    console.log("addValueToNestedKey", key, nestedContext, value)
    if (!nestedContext.hasOwnProperty(key)){
        nestedContext[key] = {"value":{}, "context":{}}
    }
    nestedContext[key].value = value;
}

async function processAction(action, context, nestedPath, req, res, next) {
    console.log("processAction", action)
    if (action.set) {
        for (const key in action.set) {

            console.log("******* nestedPath 3",nestedPath)
            let set = await getKeyAndPath(key, nestedPath);
            let nestedContext = await getNestedContext(context, set.path);
            console.log("action.set",action.set)
            console.log("context", context)
            console.log("nestedPath", nestedPath)
            console.log("set", set)
            console.log("key", key)

            let value = await replacePlaceholders(action.set[key], context, nestedPath)
            await addValueToNestedKey(set.key, nestedContext, value);
        }
    }

    if (action.target) {
        const isObj = await isOnePlaceholder(action.target)
        let strClean = await removeBrackets(action.target, isObj, false);

        console.log("******* nestedPath 4",nestedPath)
        let target = await getKeyAndPath(strClean, nestedPath);
        console.log("target>>>>", target)
        let nestedContext = await getNestedContext(context, target.path);
        console.log("nestedContext>>>>",nestedContext)

        if (!nestedContext.hasOwnProperty(target.key)){
            nestedContext[target.key] = {"value":{}, "context":{}}
        }

        console.log("replacePlaceholders>>>>",target.key, context, nestedPath)
        value = await replacePlaceholders(target.key, context, nestedPath);
        let args = [];

        // IS THERE A MORE INDUSTRY STANDARD TERM THAN THE WORD "FROM" THAT LLM WOULD UNDERSTAND BETTER?
        if (value){
            if (action.from) {
                args = await action.from.map(async item => {
                    console.log("map:item", item)
                    const fromExecuted = item.endsWith('}}!');
                    const fromObj = await isOnePlaceholder(item);
                    let value = await replacePlaceholders(item, context, nestedPath);
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
        let newNestedPath = nestedPath + "." + target.key
        result = await applyMethodChain(value, action, context, newNestedPath, res, req, next);
        if (action.assign) {
            const assignExecuted = action.assign.endsWith('}}!');
            const assignObj = await isOnePlaceholder(action.assign);
            let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);

            console.log("******* nestedPath 5",nestedPath)
            let assign = await getKeyAndPath(strClean, nestedPath);
            let nestedContext = await getNestedContext(context, assign.path);
            if (assignObj && assignExecuted && typeof result === 'function') {
                let tempFunction = () => result;
                let newResult = await tempFunction()
                console.log("%% action.assign", action.assign, nestedContext, newResult)
                await addValueToNestedKey(action.assign, nestedContext, newResult)
            } else {
                console.log("addValueToNestedKey", action.assign, nestedContext, result)
                await addValueToNestedKey(action.assign, nestedContext, result)
            }
        }
    } else if (action.assign && action.params) {
        const assignExecuted = action.assign.endsWith('}}!');
        const assignObj = await isOnePlaceholder(action.assign);
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);

        console.log("******* nestedPath 6",nestedPath)
        let assign = await getKeyAndPath(strClean, nestedPath);
        let nestedContext = await getNestedContext(context, assign.path);

        if (assignObj) {
            console.log("action==>", action, nestedPath, assign)
            let result = await createFunctionFromAction(action, context, assign.path, req, res, next)

            if (assignExecuted && typeof result === 'function'){
                    result = await result()
            } else if (typeof result === 'function'){
                    result = JSON.stringify(result);
            }
            await addValueToNestedKey(assign.key, nestedContext, result);
        } else {
            console.log("action2===>", action, nestedPath, assign)
            await addValueToNestedKey(action.assign, nestedContext, await createFunctionFromAction(action, context, assign.path, req, res, next));
        }
    } 

    if (action.execute) {
        const isObj = await isOnePlaceholder(action.execute)
        let strClean = await removeBrackets(action.execute, isObj, false);//false but will be executed below

        console.log("******* nestedPath 7",nestedPath)
        let execute = await getKeyAndPath(strClean, nestedPath);
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

async function applyMethodChain(target, action, context, nestedPath, res, req, next) {
    let result = target
    console.log("applyMethodChain",result, action, context, nestedPath)

    if (nestedPath.endsWith(".")){
        nestedPath = nestedPath.slice(0,-1)
    }

    if (nestedPath.startsWith(".")){
        nestedPath = nestedPath.slice(1)
    }

    console.log("typeof result", typeof result)
    async function instantiateWithNew(constructor, args) {
        console.log("instantiateWithNew", constructor, args)
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
                console.log("chainAction.params", chainAction.params, context, nestedPath)
                chainParams = await replacePlaceholders(chainAction.params, context, nestedPath)
            } else {
                chainParams = [];
            }

            let accessClean = chainAction.access
            if (accessClean){
                console.log("1")
                const isObj = await isOnePlaceholder(accessClean)
                console.log("1:isObj", isObj)
                accessClean = await removeBrackets(accessClean, isObj, false);
                console.log("1:accessClean", accessClean)
            }
            if (accessClean && !chainAction.params) {
                result = result[accessClean];
            } else if (accessClean && chainAction.new && chainAction.params) {
                console.log("instantiateWithNew:::: result", result, "accessClean", accessClean, "chainParams", chainParams, "result[accessClean]", result[accessClean])
                result = await instantiateWithNew(result[accessClean].value, chainParams);
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
                            if (chainAction.express){
                                console.log("2.4")
                                if (chainAction.next || chainAction.next == undefined){
                                    console.log("2.5")
                                        console.log("accessClean", accessClean)
                                        console.log("chainParams", chainParams)
                                        console.log("result", result)
                                        result = await result[accessClean](...chainParams)(req, res, next);
                                    console.log("result222", result)
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

async function createFunctionFromAction(action, context, nestedPath, req, res, next) {
    console.log("----------")
    console.log("----------")
    console.log("----------")
    console.log("createFunctionFromAction", action, context, "nestedPath =", nestedPath)
    console.log("111")
    return  async function (...args) {
        console.log("222")
        const assignExecuted = action.assign.endsWith('}}!');
        console.log("333")
        const assignObj = await isOnePlaceholder(action.assign);
        console.log("444")
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        console.log("555")
        console.log("******* nestedPath 8",nestedPath)
        let assign = await getKeyAndPath(strClean, nestedPath);
        console.log("666")
        console.log("assign.path", assign.path)
        let nestedContext = await getNestedContext(context, assign.path);
        console.log("777")
        let result;
        console.log("||assignExecuted",assignExecuted)
        console.log("||",assignObj)
        console.log("||",strClean)
        console.log("||assign",assign)
        console.log("||nestedContext", nestedContext)

        await args.reduce(async (unusedObj, arg, index) => {
            console.log("888")
            if (action.params && action.params[index]) {
                const paramExecuted = action.params[index].endsWith('}}!');
                const paramObj = await isOnePlaceholder(action.params[index]);
                let paramClean = await removeBrackets(action.params[index], paramObj, paramExecuted);

                console.log("******* nestedPath 9",nestedPath)
                let param = await getKeyAndPath(paramClean, nestedPath);
                let paramNestedContext = await getNestedContext(context, param.path);
                console.log("cFFA nestedContext",paramNestedContext)
                console.log("cFFA paramExecuted",paramExecuted)
                console.log("cFFA param",param)
                if (paramExecuted && paramObj && typeof arg === "function"){
                    console.log("is a function")
                    paramNestedContext[param.value] = await arg();
                } else {
                    console.log("is not a function", arg)
                    paramNestedContext[param.value] = arg;
                }
            }
        }, {});

        if (action.run) {
            for (const act of action.run) {
                console.log("999",)
                let newNestedPath = nestedPath+"."+assign.key
                console.log("newNestedPath", newNestedPath)
                if (newNestedPath.startsWith(".")){
                    newNestedPath = newNestedPath.slice(1)
                }
                let newNestedContext = await getNestedContext(context, newNestedPath);
                console.log("runAction", act, context, newNestedPath)
                result = await runAction(act, context, newNestedPath, req, res, next)
            }
        }
        return result;
    };
}

module.exports.lambdaHandler = serverless(lib.app);