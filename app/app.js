var express = require('express');
const serverless = require('serverless-http');
let lib = {};
lib.AWS = require('aws-sdk');
lib.app = express();
lib.path = require('path');
lib.root = {}
lib.root.session = require('express-session');
lib.fs = require('fs');
const { v4: uuidv4 } = require('uuid');
lib.uuidv4 = uuidv4
const { promisify } = require('util');
lib.exec = promisify(require('child_process').exec);
let loadMods = require('./scripts/processConfig.js')

lib.app.use(lib.root.session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } 
}));

lib.app.set('views', lib.path.join(__dirname, 'views'));
lib.app.set('view engine', 'ejs');

lib.AWS.config.update({ region: 'us-east-1' });
lib.dynamodbLL = new lib.AWS.DynamoDB();
lib.dynamodb = new lib.AWS.DynamoDB.DocumentClient();
lib.SM = new lib.AWS.SecretsManager();
lib.s3 = new lib.AWS.S3();

lib.process = process

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

var cookiesRouter;

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

var controllerRouter = require('./routes/controller')(lib.dynamodb, lib.dynamodbLL, lib.uuidv4);

lib.app.use('/controller', controllerRouter);

var indexRouter = require('./routes/index');

lib.app.use('/', indexRouter);



async function retrieveAndParseJSON(fileName) {
    const params = { Bucket: 'public.1var.com', Key: 'actions/'+fileName+'.json'};
    const data = await lib.s3.getObject(params).promise();
    return JSON.parse(data.Body.toString());
  }


  async function initializeMiddleware(req, res, next) {
    if (req.path.startsWith('/auth')) {
        console.log("req.path",req.path)
        let {setupRouter, getHead, convertToJSON} = require('./routes/cookies')
        const head = await getHead("su", req.path.split("/")[2].split("?")[0], lib.dynamodb)
        const parent = await convertToJSON(head.Items[0].su, [], null, null, lib.dynamodb)
        console.log("parent----------")
        console.log(parent)
        const arrayOfJSON = [];
        let fileArray = parent.paths[req.path.split("/")[2].split("?")[0]]; //["cf5728e1-856e-4417-82e9-ca3660babde8", "52af4786-0bfb-4731-8212-f0dfb040789f", "5761cc66-7614-4cd5-9d2e-2653b9acb70b"]////////////////////////////////////////////////////
    
        const promises = await fileArray.map(fileName => retrieveAndParseJSON(fileName));
        
        // Use Promise.all to wait for all promises to resolve
        const results = await Promise.all(promises);
        
        // Push the results into arrayOfJSON
        await results.forEach(result => arrayOfJSON.push(result));
    
        console.log("arrayOfJSON", arrayOfJSON)
        
        lib.json1 = arrayOfJSON
        return lib.json1.map(stepConfig => {
            return async (req, res, next) => {
                console.log("middleware1");
                lib.req = req;
                lib.res = res;
                lib.context = await loadMods.processConfig(stepConfig, lib.context, lib);
                lib["urlpath"] = req.path.split("?")[0];
                lib.context["urlpath"] = req.path.split("?")[0];
                lib.context["sessionID"] = req.sessionID;
                lib.next = next;
                await initializeModules(lib.context, stepConfig, req, res, next);
            };
        });
    }
}

let isMiddlewareInitialized = false;
let middlewareCache = [];

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

function condition(left, conditions, right, operator = "&&", context) {
    console.log(1)
    if (arguments.length === 1) {
        console.log(2)
        return !!left;
    }

    if (!Array.isArray(conditions)) {
        console.log(3)
        conditions = [{ condition: conditions, right: right }];
    }

    return conditions.reduce((result, cond) => {
        console.log(4)
        const currentResult = checkCondition(left, cond.condition, cond.right, context);
        if (operator === "&&") {
            return result && currentResult;
        } else if (operator === "||") {
            return result || currentResult;
        } else {
            throw new Error("Invalid operator");
        }
    }, operator === "&&");
}

function checkCondition(left, condition, right, context) {
    //console.log(5)
    //console.log("left1", left)
    left = replacePlaceholders(left, context)
    //console.log("left2",left)
    //console.log("right1", right)
    right = replacePlaceholders(right, context)
    //console.log("right2",right)
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

async function processAction(action, context, req, res, next) {
    if (action.target) {
        //console.log("getModuleInstance")
        let moduleInstance = replacePlaceholders(action.target, context);
        //console.log("moduleInstance", moduleInstance)
        let args = [];
                if (action.from) {
                    args = action.from.map(item => {
                        let isFunctionExecution = item.endsWith('!');
                        let key = isFunctionExecution ? item.slice(2, -3) : item.slice(2, -2);
                        let value = context[key];
                
                        if (isFunctionExecution && typeof value === 'function') {
                            return value();
                        }
                        return value;
                    });
                }
        let result;
        if (typeof moduleInstance === 'function') {
            console.log("moduleINstance is a function")
            if (args.length == 0) {
                console.log("args length is 0")
                result = moduleInstance;
            } else {
                console.log("args length > 0")
                result = moduleInstance(...args); 
            }
        } else {
            console.log("moduleInstance is not a function")
            result = moduleInstance;
        }
        console.log("applyMethodChain", result, action, context)
        result = await applyMethodChain(result, action, context, res, req, next);
        console.log("result", result)
        if (action.assign) {
            console.log(1, action.assign)
            if (action.assign.includes('{{')) {
                console.log(2)
                let isFunctionExecution = action.assign.endsWith('!');
                let assignKey = isFunctionExecution ? action.assign.slice(2, -3) : action.assign.slice(2, -2);
                if (isFunctionExecution) {
                    console.log(3)
                    if (typeof result === 'function'){
                        console.log(4)
                        let tempFunction = () => result;
                        context[assignKey] = tempFunction();
                    } else {
                        console.log(5)
                        context[assignKey] = result
                    }
                } else {
                    console.log(6)
                    context[assignKey] = result;
                }
            } else {
                console.log(7)
                context[action.assign] = result;
            }
        }
    } else if (action.assign && action.params) {
        if (action.assign.includes('{{')) {
            let isFunctionExecution = action.assign.endsWith('!');
            let assignKey = isFunctionExecution ? action.assign.slice(2, -3) : action.assign.slice(2, -2);
            //console.log("action/////", action)
            let result = createFunctionFromAction(action, context, req, res, next)
            //console.log("result/////",result)
            if (isFunctionExecution) {
                if (typeof result === 'function'){
                    context[assignKey] =  result()
                } else {
                    context[assignKey] =  result;
                }
            } else {
                //console.log("no !")
                if (typeof result === 'function'){
                    console.log("executing function", JSON.stringify(result))
                }
                context[assignKey] = result;
            }
        } else {
            context[action.assign] = createFunctionFromAction(action, context, req, res, next)
        }
    } 
    if (action.execute) {
        const functionName = action.execute;
        if (typeof context[functionName] === 'function') {
            if (action.express) {
                await context[functionName](req, res, next);
            } else {
                await context[functionName];
            }
        } else {
            console.error(`No function named ${functionName} found in context`);
        }
    }
    
    if (action.next) {
        next();
    }
}

async function runActionFunction(action, context, req, res, next){
    if (action != undefined){
        let runAction = true;
        if (action.if) {
            runAction = condition(action.if[0], action.if[1], action.if[2], action.if[3], context);
        } else if (action.ifs) {
            //console.log(action.ifs)
            for (const ifObject of action.ifs) {
                //console.log("ifObject", ifObject)
                runAction = condition(ifObject[0], ifObject[1], ifObject[2], ifObject[3], context);
                //console.log("runAction",runAction)
                if (!runAction) {
                    break;
                }
            }
        }

        if (runAction) {
            if (action.set) {
                for (const key in action.set) {
                    //((user)) needs to be managed in reeplacePlaceholders
                    //it could be a function and  we'll nee to account foor that.
                    context[key] = replacePlaceholders(action.set[key], context);
                }
            }

            if (action.while) {
                let whileChecker = 0
                let LEFT = action.while[0]
                let RIGHT = action.while[2]
                while (condition(LEFT, [{ condition: action.while[1], right: RIGHT }], null, "&&", context)) {
                        await processAction(action, context, req, res, next);
                    whileChecker++;
                    if (whileChecker == 10){
                        break;
                    }
                }
            }

            if (action.whiles) {
                let whileChecker = 0
                for (const whileCondition of action.whiles) {
                    while (condition(replacePlaceholders(whileCondition[0], context), 
                                    [{ condition: whileCondition[1], right: replacePlaceholders(whileCondition[2], context) }], 
                                    null, "&&", context)) {
                            await processAction(action, context, req, res, next);
                        whileChecker++;
                        if (whileChecker == 10){
                            break;
                        }
                    }
                }
            }

            if (!action.while){
                await processAction(action, context, req, res, next);
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

async function initializeModules(context, config, req, res, next) {
    require('module').Module._initPaths();
    for (const action of config.actions) {
        let runResponse = await runActionFunction(action, context, req, res, next);
        if (runResponse == "contune"){
            continue
        }
    }
}

function createFunctionFromAction(action, context, req, res, next) {
    return async function(...args) {

        let result;
        let scope = args.reduce((acc, arg, index) => {
            if (action.params && action.params[index]) {
                const paramName = action.params[index].replace(/\(\(|\)\)/g, '');
                acc[paramName] = arg;
            }
            return acc;
        }, {});
        console.log("scope", scope)
        if (action.chain) {
            for (const chainAction of action.chain) {
                const chainParams = await Array.isArray(chainAction.params) ? chainAction.params.map(async param => {
                    return await replaceParams(param, context, scope, args);
                }) : [];

                if (typeof chainAction.access === 'string') {
                    if (chainAction.access.startsWith('((') && chainAction.access.endsWith('))')) {
                        const methodName = chainAction.access.slice(2, -2);
                        if (typeof scope[methodName] === 'function') {
                            result = scope[methodName](...chainParams);
                        } else {
                            console.error(`Callback method ${methodName} is not a function`);
                            return;
                        }
                    } else if (result && typeof result[chainAction.access] === 'function') {
                        //console.log("this is a function")
                        result = result[chainAction.access](...chainParams);
                    } else {
                        console.error(`Method ${chainAction.access} is not a function on result`);
                        return;
                    }
                }
            }
        }
        if (action.run) {
            for (const runAction of action.run) {
                /*const runParams = Array.isArray(runAction.params) ? runAction.params.map(param => {
                    return replaceParams(param, context, scope, args);
                }) : [];*/
                console.log("runAction", runAction)
                await runActionFunction(runAction, context, req, res, next)
                /*
                if (typeof runAction.access === 'string') {
                    if (runAction.access.startsWith('{{')) {
                        console.log("starts with {{")
                        if (runAction.add && typeof runAction.add === 'number'){
                            const contextKey = runAction.access.slice(2, -2);
                            let val = replacePlaceholders(runAction.access, context);
                            if (typeof val === 'number') {
                                result = val + runAction.add;
                            } else {
                                console.error(`'${contextKey}' is not a number or not found in context`);
                            }
                        }else if (runAction.subtract && typeof runAction.subtract === 'number'){
                            const contextKey = runAction.access.slice(2, -2); 
                            let val = replacePlaceholders(runAction.access, context);
                            if (typeof val === 'number') {
                                result = val - runAction.subtract; 
                            } else {
                                console.error(`'${contextKey}' is not a number or not found in context`);
                            }
                        } else {
                            //console.log("runAction.access.splice(2,-2)",runAction.access.slice(2,-2))
                            //console.log("lib.context[runAction.access.splice(2,-2)]",lib.context[runAction.access.slice(2,-2)])
                            result = lib.context[runAction.access.slice(2,-2)]
                            //console.log("runParams", runParams)


                            for (const paramItem of runParams){
                                let val = replaceParams(runParams[0], context, scope, args);
                                //console.log("val++", val)
                                lib.context[runAction.access.slice(2,-2)] = val
                            }
                        }
                    } else if (runAction.access.startsWith('((') && runAction.access.endsWith('))')) {
                        const methodName = runAction.access.slice(2, -2);
                        if (typeof scope[methodName] === 'function') {
                            result = scope[methodName](...runParams);
                        } else {
                            console.error(`Callback method ${methodName} is not a function`);
                            return;
                        }
                    } else if (runAction.access == "next") {
                        next();
                    }*/
                //}
            }
        }
        return result;
    };
}

function replaceParams(param, context, scope, args) {
    if (param) {
        if (typeof param === 'string'){
            if (param.startsWith('((') && param.endsWith('))')) {
                const paramName = param.slice(2, -2);
                if (!isNaN(paramName)) {
                    return args[paramName];
                }

                if (param.includes(".")){
                    console.log("includes .")
                    const keys = paramName.split('.');
                    console.log("keys", keys)
                    let value = keys.reduce((currentContext, key) => {
                        console.log("key2", key, currentContext)
                        if (currentContext && currentContext[key] !== undefined) {
                            console.log("returning currentContext[key]", currentContext[key], key, currentContext)
                            return currentContext[key];
                        }
                    }, lib.context);
                    console.log("value", value)
                    return value
                }

                return scope[paramName] || context[paramName] || param;
            }
        } else {
            console.log("typeof param", typeof param)
        }
    }
    return param;
}

function replacePlaceholders(item, context) {
    //console.log("item context", item, context)
    let processedItem = item;
    console.log("typeof processedItem", typeof processedItem)
    if (typeof processedItem === 'string') {
        //console.log("processedItem typeof", processedItem)
        processedItem = processString(processedItem, context);
        //console.log("processedItem", processedItem)
    } else if (Array.isArray(processedItem)) {
        //console.log("Array.isArray(processedItem))",Array.isArray(processedItem))
        processedItem =  processedItem.map(element => replacePlaceholders(element, context));
    }
    //console.log("returning")
    return processedItem;
}

function processString(str, context) {
    console.log("1 str",str)
    console.log("2 context",context)
    let tmpStr = "";
    if (str.startsWith('{{')) {
        tmpStr = str.slice(2, -2);
    } else {
        tmpStr = str
    }

    if (lib[tmpStr]) {
        console.log("3 lib", lib)
        console.log("4 str", tmpStr)
        return lib[tmpStr];
    }

    if (lib.context[tmpStr]){
        console.log("5 lib context found", tmpStr)
        console.log("6 lib.context[tmpStr]", lib.context[tmpStr])
        return lib.context[tmpStr]
    }

    try {
        console.log("7 resolve", require.resolve("/tmp/node_modules/"+tmpStr))
        if (require.resolve("/tmp/node_modules/"+tmpStr)) {
            console.log("8 /tmp/node_modules/"+tmpStr)
            return require("/tmp/node_modules/"+tmpStr);
        }
    } catch (e) {
        console.error(`Module '${str}' cannot be resolved:`, e);
    }

    console.log("9 after")
    const singlePlaceholderRegex = /^\{\{([^}]+)\}\}!?$/
    const singleMatch = str.match(singlePlaceholderRegex);

    if (singleMatch) {
        const keyPath = singleMatch[1];
        const isFunctionExecution = str.endsWith('}}!');
        let value = resolveValueFromContext(keyPath, context);

        if (isFunctionExecution && typeof value === 'function') {
            return value();
        } else {
            return value;
        }
    }

    return str.replace(/\{\{([^}]+)\}\}/g, (match, keyPath) => {
        let isFunctionExecution = match.endsWith('}}!');
        if (isFunctionExecution) {
            keyPath = keyPath.slice(0, -1); 
        }
        let value = resolveValueFromContext(keyPath, context);
        if (isFunctionExecution && typeof value === 'function') {
            return value();
        }
        return value !== undefined ? value : match; 
    });
}

function resolveValueFromContext(keyPath, context, convertToString = false) {
    const keys = keyPath.split('.');
    let value = keys.reduce((currentContext, key) => {
        return currentContext && currentContext[key] !== undefined ? currentContext[key] : undefined;
    }, context);
    if (typeof value === 'function') {
        value = value();
    }
    if (convertToString && value !== undefined) {
        return String(value); 
    }
    return value;
}


/*
//NEW PROCESSPARAM
function processParam(param, context) {
    // Handle string type parameters
    if (typeof param === 'string') {
        // If the parameter exactly matches "{{}}", return the whole context
        if (param === "{{}}") {
            return context;
        }
        // If the parameter contains one or more instances of "{{...}}"
        if (param.includes('{{')) {
            // Find all instances of "{{...}}" and replace them with the appropriate value from the context
            return param.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
                let isFunctionExecution = key.endsWith('!');
                let actualKey = isFunctionExecution ? key.slice(0, -1) : key;
                let value = context[actualKey];

                if (isFunctionExecution && typeof value === 'function') {
                    return value();
                }

                return value !== undefined ? value : actualKey;
            });
        }
        // If the parameter is a simple string without "{{...}}", return it as is
        return param;
    }
    // Handle array type parameters
    else if (Array.isArray(param)) {
        return param.map(item => processParam(item, context));
    }
    // Handle object type parameters
    else if (typeof param === 'object' && param !== null) {
        const processedParam = {};
        for (const [key, value] of Object.entries(param)) {
            processedParam[key] = processParam(value, context);
        }
        return processedParam;
    }
    // Return the parameter as is for other types
    else {
        return param;
    }
}*/

function processParam(param, context) {
    if (typeof param === 'string') {
        if (param == "{{}}"){
            return context;
        }
        if (param.startsWith('{{')) {

            let isFunctionExecution = param.endsWith('!');
            let key = isFunctionExecution ? param.slice(2, -3) : param.slice(2, -2);
            let value = context[key];

            if (isFunctionExecution && typeof value === 'function') {
                return value();
            }

            if (value !== undefined) {
                return value;
            } else {
                return key;
            }
        }
        return param;
    } else if (Array.isArray(param)) {
        return param.map(item => processParam(item, context));
    } else if (typeof param === 'object' && param !== null) {
        const processedParam = {};
        for (const [key, value] of Object.entries(param)) {
            processedParam[key] = processParam(value, context);
        }
        return processedParam;
    } else {
        return param;
    }
}

async function applyMethodChain(target, action, context, res, req, next) {
    let result = target;

    function instantiateWithNew(constructor, args) {
        return new constructor(...args);
    }

    if (action.access) {
        let params;

        if (action.params) {
            params = replacePlaceholders(action.params, context);
        } else {
            params = [];
        }
        if (action.new) {
            result = instantiateWithNew(result, params);
        } else {
            result = typeof result === 'function' ? result(...params) : result && typeof result[action.access] === 'function' ? result[action.access](...params) : result[action.access] === 'object' ? result[action.access] : null;
        }
    }

    if (action.chain && result) {
        for (const chainAction of action.chain) {
            if (chainAction.hasOwnProperty('return')) {
                return chainAction.return;
            }
            let chainParams;

            if (chainAction.params) {
                chainParams = chainAction.params.map(param => {
                    return processParam(param, context, true)
                });
            } else {
                chainParams = [];
            }
            if (chainAction.access && !chainAction.params) {   
                result = result[chainAction.access];
            } else if (chainAction.new) {
                
                result = instantiateWithNew(result[chainAction.access], chainParams);
            } else if (typeof result[chainAction.access] === 'function') {
                if (chainAction.access === 'promise') {
                    result = await result.promise();
                } else {
                    if (chainAction.new) {
                        result = new result[chainAction.access](...chainParams);
                    } else {
                        console.log("ELSE result", result)
                        console.log("ELSE chainAction.access", chainAction.access)
                        console.log("ELSE chainParams", chainParams)
                        console.log("z1")
                        if (chainAction.access && chainAction.access.length != 0){
                            console.log("z2")
                            if (chainAction.access.startsWith('{{')) {
                                console.log("z3")
                                const methodFunction = replacePlaceholders(chainAction.access, context)
                                if (typeof methodFunction === 'function') {
                                    console.log("z4")
                                    if (chainAction.express){
                                        console.log("z5")
                                        if (chainAction.next || chainAction.next == undefined){
                                            result = methodFunction(...chainParams)(req, res, next);
                                        } else {
                                            result = methodFunction(...chainParams)(req, res);
                                        }
                                    } else {
                                        console.log("z6")
                                        result = methodFunction(...chainParams);
                                    }
                                } else {
                                    console.error(`Method ${methodName} is not a function in context`);
                                    return;
                                }
                            } else {
                                if (chainAction.express){
                                    console.log("chainAction")
                                    if (chainAction.next || chainAction.next == undefined){
                                            result = result[chainAction.access](...chainParams)(req, res, next);
                                    } else {
                                            result = result[chainAction.access](...chainParams)(req, res);
                                    }
                                } else {
                                    try{
                                        console.log("try")
                                    result = result[chainAction.access](...chainParams);
                                    } catch(err){
                                        console.log("err", err)
                                        result = result
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                console.error(`Method ${chainAction.access} is not a function on ${action.target}`);
                return;
            }
        }
    }
    return result;
}

module.exports.lambdaHandler = serverless(lib.app);