var express = require('express');
const serverless = require('serverless-http');
// SEE IF WE CAN INCORPORATE LIB INTO EACH INITIAL WEB CALL SO IT'S NOT EXPOSED TO OTHER USERS WHO USE THE INVOKE!!!!!!!!!!!!!!!!!!!!!
let lib = {};
lib.modules = {};
lib.AWS = require('aws-sdk');
lib.app = express();
lib.path = require('path');
lib.root = {"value":"", "context":{}}
//lib.root.context.process = process
lib.root.context.session = require('express-session');
lib.fs = require('fs');
const { v4: uuidv4 } = require('uuid');
lib.uuidv4 = uuidv4
const { promisify } = require('util');
lib.exec = promisify(require('child_process').exec);
lib.app.use(lib.root.context.session({secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true, cookie: { secure: true }}));
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
                lib.root.context = await processConfig(userJSON, lib.root.context, lib);
                lib.root.context["urlpath"] = {"value":req.path.split("?")[0], "context":{}}
                lib.root.context["sessionID"] = {"value":req.sessionID, "context":{}}
                await initializeModules(lib, userJSON, req, res, next);
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
            console.log("part", part)
            //if (partCounter < parts.length-1){
                tempContext = tempContext[part].context;
            //}
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
                console.log("tempContext1", tempContext)
            } else {
                tempContext = tempContext[part].value;
                console.log("tempContext2", tempContext)
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
            console.log("Invalid operator");
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
        console.log("string", processedItem)
        if (nestedPath == "root" && processedItem == "{{callbackFunction}}"){
            console.log("!!!!!!!!!!!!!!!!!!", lib.root.context.callbackFunction.value)
            //return lib.root.context.callbackFunction.value
        }
        let stringResponse = await processString(processedItem, libs, nestedPath);
        console.log("!!!stringResponse", stringResponse)
        console.log("!!!processedItem",processedItem)
        console.log("!!!nestedPath",nestedPath)
        return stringResponse;
    } else if (Array.isArray(processedItem)) {
        console.log("array", processedItem)
        let newProcessedItem2 =  processedItem.map(async element => {
            console.log("element", element, libs, nestedPath)
            return await replacePlaceholders(element, libs, nestedPath)
        });
        console.log("newProcessedItem2",newProcessedItem2 )
        return await Promise.all(newProcessedItem2);
    } else {
        return item
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
    let val = str.split(".");

    let key = str;
    let path = "";
    if (str.startsWith("~/")){
        val.unshift("root")
    }
    if (val.length > 1){
        key = val[val.length]
        console.log("val", val)
        path = val.slice(0, -1)
        console.log("path1", path)
        path = path.join(".")
        console.log("path2", path)
    }
    if (nestedPath != ""){
        path = nestedPath + "." + path
    }
    if (path.endsWith(".")){
        path = path.slice(0,-1)
    }
    return {"key":key, "path":path}
}

async function processString(str, libs, nestedPath) {
    console.log("str ********************",str, nestedPath)
    const isExecuted = str.endsWith('}}!');
    //console.log("isExecuted",isExecuted)
    const isObj = await isOnePlaceholder(str)
    //console.log("isObj",isObj)
    let strClean = await removeBrackets(str, isObj, isExecuted);
    //console.log("strClean",strClean)
    let target = await getKeyAndPath(strClean, nestedPath)
    //console.log("target",target)
    let nestedContext = await getNestedContext(libs, target.path)

    //console.log("nestedContext",nestedContext)
    let nestedValue= await getNestedValue(libs, target.path)

    //console.log("processString-------------------")
    //console.log("nestedValue",nestedValue)
    //console.log("libs.root.context", libs.root.context)
    //console.log("typeof nestedValue", typeof nestedValue)
    //console.log(" nestedValue[target.key]",  nestedValue[target.key])
    //console.log("typeof nestedValue[target.key]", typeof nestedValue[target.key])
    if (nestedContext.hasOwnProperty(target.key)){
        //console.log("1")
        let value = nestedContext[target.key].value
        //console.log("value1", value)
        //console.log("typeof value1", typeof value)
        if (typeof value === 'function') {
            //console.log("2", value)
            if (isExecuted){
            value = await value();
            }
        }
        //console.log("Object.keys(value).length",Object.keys(value).length)
        //if (Object.keys(value).length > 0 && value){
        //    console.log("3", value)
        //    return isExecuted ? await value() : value
        //}
        //console.log("4", value)
        return value
    }
    if (!isObj){
        //console.log("5")
        let returnValue = await str.replace(/\{\{([^}]+)\}\}/g, async (match, keyPath) => {
            //console.log("keyPath",keyPath)
            let target = await getKeyAndPath(keyPath, nestedPath)
            let value = await getNestedContext(libs, target.path)?.[target.key].value;
            //console.log("target5", target)
            //console.log("value5", value)
            return value !== undefined ? value : match; 
        });
        //console.log("returnValue", returnValue)
        return returnValue
    }
    //console.log("RETRUN6")
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
    console.log("########################")
    console.log("addValueToNestedKey")
    console.log(key, value, nestedContext)
    if (value == undefined || key == undefined){
        console.log("key/value undefined")
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
            console.log("^^^ set", set)
            let nestedContext = await getNestedContext(libs, set.path);
            console.log("$set.path", set.path, "nestedPath", nestedPath)
            let value = await replacePlaceholders(action.set[key], libs, nestedPath)
            console.log("addValueTo:1", set.key, nestedContext, value)
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

        console.log("||||||||||||||||||||||||")
        console.log("||||||||||||||||||||||||")
        console.log("||||||||||||||||||||||||")
        console.log(nestedPath, target)
        console.log("||||||||||||||||||||||||")
        console.log("||||||||||||||||||||||||")
        console.log("||||||||||||||||||||||||")

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
            const assignObj = await isOnePlaceholder(action.assign);
            let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);

            let assign = await getKeyAndPath(strClean, nestedPath);
            let nestedContext = await getNestedContext(libs, assign.path);
            if (assignObj && assignExecuted && typeof result === 'function') {
                let tempFunction = () => result;
                let newResult = await tempFunction()
                console.log("addValueTo:2", action.assign, nestedContext, newResult)
                await addValueToNestedKey(action.assign, nestedContext, newResult)
            } else {
                console.log("addValueTo:3", action.assign, nestedContext, result)
                await addValueToNestedKey(action.assign, nestedContext, result)
            }
        }
    } else if (action.assign && action.params) {
        console.log("assign&param", action.assign, action.params)
        const assignExecuted = action.assign.endsWith('}}!');
        const assignObj = await isOnePlaceholder(action.assign);
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        let assign = await getKeyAndPath(strClean, nestedPath);
        let nestedContext = await getNestedContext(libs, assign.path);
        console.log("nestedContext", assign.path, nestedContext)
        if (assignObj) {
            let result = await createFunctionFromAction(action, libs, assign.path, req, res, next)
            if (assignExecuted && typeof result === 'function'){
                    result = await result()
            } else if (typeof result === 'function'){
                    result = JSON.stringify(result);
            }
            console.log("addValueTo:4", assign.key, nestedContext, result)
            await addValueToNestedKey(assign.key, nestedContext, result);
        } else {
            console.log("addValueTo:5", action.assign, nestedContext, "await createFunctionFromAction")
            await addValueToNestedKey(action.assign, nestedContext, await createFunctionFromAction(action, libs, assign.path, req, res, next));
        }
    } 

    if (action.execute) {
        const isObj = await isOnePlaceholder(action.execute)
        let strClean = await removeBrackets(action.execute, isObj, false);//false but will be executed below

        console.log("******* nestedPath 7",nestedPath)
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
        console.log("constructor", constructor)
        console.log("args",args)
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


            console.log("Pre Conditions ------------")
            console.log("target", target)
            console.log("action", action)
            console.log("libs.root.context", libs.root.context)
            console.log("nestedPath", nestedPath)
            console.log("accessClean", accessClean)
            console.log("chainAction.params", chainAction.params)
            console.log("chainParams", chainParams)
            console.log("result", result)

            if (accessClean && !chainAction.params) {
                result = result[accessClean];
            } else if (accessClean && chainAction.new && chainAction.params) {
                console.log("result", result, accessClean, result[accessClean], chainParams) // ERROR IS HERE
                result = 
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
                                    console.log("next true or undefined ---")
                                        result = await result[accessClean](...chainParams)(req, res, next);
                                } else {
                                    console.log("next false ---")
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
    return  async function (...args) {
        const assignExecuted = action.assign.endsWith('}}!');
        const assignObj = await isOnePlaceholder(action.assign);
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        let assign = await getKeyAndPath(strClean, nestedPath);
        let nestedContext = await getNestedContext(libs, assign.path);
        let result;
        console.log("createFunctionFromAction : action", action)
        console.log("createFunctionFromAction : nestedPath", nestedPath)
        console.log("createFunctionFromAction : args", args)
        console.log("createFunctionFromAction : assign", assign)
        console.log("createFunctionFromAction : nestedContext", nestedContext)
        let addToNested = await args.reduce(async (unusedObj, arg, index) => {
            console.log("888")
            if (action.params && action.params[index]) {

                //we need to create objects out of these params so that the run can target them. Currently params are saved at lib.context
                //and they need to be in the newNestedContext. 
                console.log("------Inside args reduce")
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
        console.log("createFunctionFromAction : addToNested", addToNested)

        if (action.params){
            for (par in action.params){
                let param = action.params[par]
                if (param != null && param != null && param != ""){
                    const paramExecuted = param.endsWith('}}!');
                    const paramObj = await isOnePlaceholder(param);
                    console.log("paramObj", paramObj)
                    let paramClean2 = await removeBrackets(param, paramObj, paramExecuted);
                    console.log("paramClean", paramClean2)
                    let newNestedPath = nestedPath+"."+assign.key
                    console.log("newNestedPath///////", newNestedPath)
                    let p = await getKeyAndPath(paramClean2, newNestedPath);
                    let nestedParamContext = await getNestedContext(libs, p.path);
                    console.log("addValueTo:6", paramClean2, nestedParamContext, {})
                    addValueToNestedKey(paramClean2, nestedParamContext, {})
                    console.log("lib.root.context", lib.root.context)
                    console.log("lib.root.context[assign.key]", lib.root.context[assign.key])
                }
            }
        }

        if (action.run) {
            for (const act of action.run) {
                //We don't need to create an object in newNestedContext, that is the params job. We need to access it and create a new 
                //obj that saves the output.

                //if (act.hasOwnProperty("target")){
                    //const targetExecuted = act.target.endsWith('}}!');
                    //const isTargetObj = await isOnePlaceholder(act.target);
                    //let targetClean = await removeBrackets(act.target, isTargetObj, targetExecuted);
                    //console.log("addValueToNestedKey", targetClean, nestedContext, {})
                    //console.log("addValueTo:7", paramClean, nestedParamContext, {})
                    //addValueToNestedKey(paramClean, nestedParamContext, {})
                //}
                let newNestedPath = nestedPath+"."+assign.key
                console.log("newNestedPath")
                let newNestedContext = await getNestedContext(libs, newNestedPath);
                console.log("runAction::::::", act, libs, newNestedContext)
                result = await runAction(act, libs, newNestedPath, req, res, next)
            }
        }
        return result;
    };
}

module.exports.lambdaHandler = serverless(lib.app);