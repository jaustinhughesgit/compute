
var express = require('express');
let local = {};
local.AWS = require('aws-sdk');
local.dyRouter = express.Router();
local.path = require('path');
local.unzipper = require('unzipper');
local.fs = require('fs');
local.session = require('express-session');
local.s3 = new local.AWS.S3();

local.dyRouter.use(local.session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } 
}));


const json = {
    "modules": {
        "passport":"passport",
        "passport-microsoft":"passport-microsoft"
    },
    "actions": [
        {
            //"if":["{{urlpath}}","!=","/microsoft/callback"],
            "module":"passport",
            "chain":[
            ],
            "assignTo":"{{passport}}"
        },
        {
            "if":["{{urlpath}}","!=","/microsoft/callback"],
            "params":["{accessToken}", "{refreshToken}", "{profile}", "{done}"], 
            "chain":[],
            "run":[
                {"method":"{done}", "params":[null, "{profile}"]}
            ],
            "assignTo":"callbackFunction"
        },
        {
            "if":["{{urlpath}}","!=","/microsoft/callback"],
            "module":"passport-microsoft",
            "chain":[
               {"method":"Strategy", "params":[
                {
                    "clientID": process.env.MICROSOFT_CLIENT_ID,
                    "clientSecret": process.env.MICROSOFT_CLIENT_SECRET,
                    "callbackURL": "https://compute.1var.com/auth/microsoft/callback",
                    "resource": "https://graph.microsoft.com/",
                    "tenant": process.env.MICROSOFT_TENANT_ID,
                    "prompt": "login",
                    "state": false,
                    "type": "Web",
                    "scope": ["user.read"]
                },"{{callbackFunction}}"
               ],
                "new":true}
            ],
            "assignTo":"passportmicrosoft"
        },
        {
            "if":["{{urlpath}}","!=","/microsoft/callback"],
            "module":"{{passport}}",
            "chain":[
                {"method":"use", "params":["{{passportmicrosoft}}"]}
            ],
            "assignTo":"newStrategy"
        }
    ]
}


const json2 = {
    "modules": {
    },
    "actions": [
        {
            //"ifArray":[["{{urlpath}}","!=","/microsoft/callback"]],
            "module":"{{passport}}",
            "chain":[
                {"method":"authenticate", "params":["microsoft"], "express":true},
            ],
            "assignTo":"newAuthentication"
        }/*,
        {
            "ifArray":[["{{urlpath}}","==","/microsoft/callback"]],
            "module":"req",
            "chain":[
                {"method":"isAuthenticated", "params":[]}
            ],
            "express":true,
            "assignTo":"{{isAuth}}"
        }*/
    ]
}


const json3 = {
    "modules": {
    },
    "actions": [
        {
            "ifArray":[["{{urlpath}}","==","/microsoft/callback"]],
            "module":"res",
            "chain":[
                {"method":"json", "params":["{{}}"]}
            ],
            "assignTo":"{{getJson}}!"
        }
    ]
}
async function firstLoad(req, res, next){
    local.req = req;
    local.res = res;
    local.console = console;
    local.context = await processConfig(json);
    local.context["urlpath"] = req.path
    local.context["strategy"] = req.path.startsWith('/auth') ? req.path.split("/")[2] : "";
    await initializeModules(local.context, json, req, res, next);
    local.context.passport.serializeUser(function(user, done) {
        done(null, user);
    });

    local.context.passport.deserializeUser(function(user, done) {
        done(null, user);
    });

    local.dyRouter.use(local.context.passport.initialize());
    local.dyRouter.use(local.context.passport.session());
    next();
}
async function secondLoad(req, res, next){
    local.context.passport.authenticate('microsoft', { failureRedirect: '/login' })
    next();
}
local.dyRouter.all('/*', firstLoad, secondLoad, async function(req, res, next) {
    console.log("========>",req.isAuthenticated())
    await initializeModules(local.context, json3, req, res, next);
    console.log("done")
    res.send('Protected Option 1');
});

/*
let authenticated = false;
function dynamicPassportConfig(req, res, next) {
    req.foo = "bar";  // Attach 'foo' to the request object

    if (!req.passportConfigured) {

        pass.use(new MicrosoftStrategy(
            {
                "clientID": process.env.MICROSOFT_CLIENT_ID,
                "clientSecret": process.env.MICROSOFT_CLIENT_SECRET,
                "callbackURL": "https://compute.1var.com/auth/microsoft/callback",
                "resource": "https://graph.microsoft.com/",
                "tenant": process.env.MICROSOFT_TENANT_ID,
                "prompt": "login",
                "state": false,
                "type": "Web",
                "scope": ["user.read"]
            }, (token, tokenSecret, profile, done) => {
                authenticated = true;
                console.log("token", token);
                console.log("tokenSecret");
                console.log("profile", profile);
                done(null, profile);
            }));

            pass.serializeUser(function(user, done) {
            done(null, user);
        });

        pass.deserializeUser(function(user, done) {
            done(null, user);
        });

        local.dyRouter.use(pass.initialize());
        local.dyRouter.use(pass.session());
        console.log ("req.isAuthenticated", req.isAuthenticated())
        req.passportConfigured = true; // Mark passport as configured
        
    }
    next();
}

local.dyRouter.all('/*', dynamicPassportConfig, pass.authenticate('microsoft', { failureRedirect: '/login' }), async function(req, res, next) {
    console.log("========>",req.isAuthenticated())
    res.send('Protected Option 1');
});
*/

function testFunction(){
    return "hello world"
}

function newFunction(val){
return val + "!"
}

/*local.dyRouter.get('/', async function(req, res, next) {
    let context = {};
    context["testFunction"] = testFunction;
    context["newFunction"] = newFunction;
    context = await processConfig(json, context);
    await initializeModules(context, json);
    context["testFunctionResult"] = testFunction();
    context["newFunctionResult"] = newFunction("test");
    context["customFunctionResult"] = context["customFunction"]("yoyo");
    res.json(context);
});*/

function condition(left, condition, right, context){
    left = replacePlaceholders(left, context)
    condition = replacePlaceholders(condition, context)
    right = replacePlaceholders(right, context)

    if (condition == "=="){
        if (left == right){ return true } else { return false }
    } else if (condition == "!="){
        if (left != right){ return true } else { return false }
    } else if (condition == ">"){
        if (left > right){ return true } else { return false }
    } else if (condition == ">="){
        if (left >= right){ return true } else { return false }
    } else if (condition == "<"){
        if (left < right){ return true } else { return false }
    } else if (condition == "<="){
        if (left <= right){ return true } else { return false }
    } else if ((!condition || condition == "") && (!right || right == "")){
        if (left){ return true} else { return false}
    }
}

async function initializeModules(context, config, req, res, next) {
    require('module').Module._initPaths();
    for (const action of config.actions) {

        let runAction = true
        if (action.if) {
                runAction = condition(action.if[0],action.if[1],action.if[2], context)
        }

        if (action.ifArray) {
                for (const ifObject of action.ifArray){
                    runAction = condition(ifObject[0],ifObject[1],ifObject[2], context)
                    if (!runAction){
                        break;
                    }
                }
        }
        
        if (runAction){
            if (action.set){
                for (key in action.set){
                    context[key] = replacePlaceholders(action.set[key], context)
                }
            }

            if (action.execute) {
                const functionName = action.execute;
                if (typeof context[functionName] === 'function') {
                    if (action.express){
                        await context[functionName](req, res, next);
                        console.log("deep other auth =>", req.isAuthenticated())
                    } else {
                        await context[functionName]
                    }
                    continue;
                } else {
                    console.error(`No function named ${functionName} found in context`);
                    continue;
                }
            }

            if (!action.module && action.assignTo && action.params && action.chain) {
                context[action.assignTo] = createFunctionFromAction(action, context, req, res, next)
                continue;
            }

            if (action.module){
                let moduleInstance
                console.log("action",action)
                if (action.module.startsWith("{{")){
                    console.log("<-- context")
                    moduleInstance = context[action.module.replace("{{","").replace("}}","")]
                 } else if (local[action.module]){
                    console.log("<-- local")
                    moduleInstance = local[action.module]
                 } else {
                    console.log("<-- require")
                    moduleInstance = require(action.module);
                 }

                let args = [];
                if (action.valueFrom) {
                    args = action.valueFrom.map(item => {
                        let isFunctionExecution = item.endsWith('!');
                        let key = isFunctionExecution ? item.slice(2, -3) : item.slice(2, -2);
                        let value = context[key];
                
                        if (isFunctionExecution && typeof value === 'function') {
                            return value();
                        }
                        return value;
                    });
                }
                console.log("typeof moduleInstance", typeof moduleInstance)
                let result = typeof moduleInstance === 'function' ? moduleInstance(...args) : moduleInstance;
                result = await applyMethodChain(result, action, context, res, req, next);
                if (action.assignTo) {
                    if (action.assignTo.includes('{{')) {
                        let isFunctionExecution = action.assignTo.endsWith('!');
                        let assignKey = isFunctionExecution ? action.assignTo.slice(2, -3) : action.assignTo.slice(2, -2);
                        
                        if (isFunctionExecution) {
                            context[assignKey] = typeof result === 'function' ? result() : result;
                        } else {
                            console.log("assignTo", action.assignTo)
                            console.log(result)
                            context[assignKey] = result;
                        }
                    } else {
                        console.log("moduleInstance", result)
                        context[action.assignTo] = result;
                    }
                }
            }
        }
    }
}

function createFunctionFromAction(action, context, req, res, next) {
    return function(...args) {
        let result;
        let scope = args.reduce((acc, arg, index) => {
            if (action.params && action.params[index]) {
                const paramName = action.params[index].replace(/[{}]/g, '');
                acc[paramName] = arg;
            }
            return acc;
        }, {});

        if (action.chain) {
            for (const chainAction of action.chain) {
                const chainParams = Array.isArray(chainAction.params) ? chainAction.params.map(param => {
                    return replaceParams(param, context, scope, args);
                }) : [];

                if (typeof chainAction.method === 'string') {
                    if (chainAction.method.startsWith('{') && chainAction.method.endsWith('}')) {
                        const methodName = chainAction.method.slice(1, -1);
                        if (typeof scope[methodName] === 'function') {
                            result = scope[methodName](...chainParams);
                        } else {
                            console.error(`Callback method ${methodName} is not a function`);
                            return;
                        }
                    } else if (result && typeof result[chainAction.method] === 'function') {
                        result = result[chainAction.method](...chainParams);
                    } else {
                        console.error(`Method ${chainAction.method} is not a function on result`);
                        return;
                    }
                }
            }
        }

        if (action.run) {
            for (const runAction of action.run) {
                const runParams = Array.isArray(runAction.params) ? runAction.params.map(param => {
                    return replaceParams(param, context, scope, args);
                }) : [];

                if (typeof runAction.method === 'string') {
                    if (runAction.method.startsWith('{') && runAction.method.endsWith('}')) {
                        const methodName = runAction.method.slice(1, -1);
                        if (typeof scope[methodName] === 'function') {
                            result = scope[methodName](...runParams);
                        } else {
                            console.error(`Callback method ${methodName} is not a function`);
                            return;
                        }
                    }
                }
            }
        }

        return result;
    };
}

function replaceParams(param, context, scope, args) {
    if (param) {
        if (param.startsWith('{') && param.endsWith('}')) {
            const paramName = param.slice(1, -1);
            // Check if paramName is a number (indicating an index in args)
            if (!isNaN(paramName)) {
                return args[paramName];
            }
            return scope[paramName] || context[paramName] || param;
        }
    }
    return param;
}

function replacePlaceholders(str, context) {
    if (typeof str === 'string') {
        if (str == "{{}}"){
            return context
        }
        return str.replace(/\{\{([^}]+)\}\}/g, (match, keyPath) => {
            const keys = keyPath.split('.');
            let value = keys.reduce((currentContext, key) => {
                return currentContext && currentContext[key] !== undefined ? currentContext[key] : undefined;
            }, context);

            if (typeof value === 'function') {
                return value;
            } else {
                if (value !== undefined) {
                    return value;
                } else {
                    return keyPath;
                }
            }
        });
    }
    return str;
}

async function applyMethodChain(target, action, context, res, req, next) {
    let result = target;

    function processParam(param) {
        if (typeof param === 'string') {
            if (param == "{{}}"){
                return context
            }
            if (param.startsWith('{{') && param.endsWith('}}')) {
                const key = param.slice(2, -2);
                const value = context[key];
                if (typeof value === 'function') {
                    return value;
                }
                if (value !== undefined) {
                    return value;
                } else {
                    return key;
                }
            }
            return param;
        } else if (Array.isArray(param)) {
            return param.map(item => processParam(item));
        } else if (typeof param === 'object' && param !== null) {
            const processedParam = {};
            for (const [key, value] of Object.entries(param)) {
                processedParam[key] = processParam(value);
            }
            return processedParam;
        } else {
            return param;
        }
    }

    function instantiateWithNew(constructor, args) {
        return new constructor(...args);
    }

    if (action.method) {
        let params;

        if (action.params) {
            params = action.params.map(param => {
                if (typeof param === 'string'){
                        param = replacePlaceholders(param, context)
                }
                return processParam(param);
            });
        } else {
            params = [];
        }
        if (action.new) {
            result = instantiateWithNew(result, params);
        } else {
            result = typeof result === 'function' ? result(...params) : result && typeof result[action.method] === 'function' ? result[action.method](...params) : result[action.method] === 'object' ? result[action.method] : null;
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
                    if (typeof param === 'string'){
                        if (!param.startsWith("{{")){
                            param = replacePlaceholders(param, context)
                        }
                    }
                    return processParam(param);
                });
            } else {
                chainParams = [];
            }

            if (chainAction.new) {
                result = instantiateWithNew(result[chainAction.method], chainParams);
            } else if (typeof result[chainAction.method] === 'function') {
                if (chainAction.method === 'promise') {
                    result = await result.promise();
                } else {
                    if (chainAction.new) {
                        result = new result[chainAction.method](...chainParams);
                    } else {
                        if (chainAction.method && chainAction.method.length != 0){
                            if (chainAction.method.startsWith('{{') && chainAction.method.endsWith('}}')) {
                                const methodName = chainAction.method.slice(2, -2);
                                const methodFunction = context[methodName];
                                if (typeof methodFunction === 'function') {
                                    if (chainAction.express){
                                        result = methodFunction(...chainParams)(req, res, next);
                                        console.log("deep auth => ", req.isAuthenticated())
                                    } else {
                                        result = methodFunction(...chainParams);
                                    }
                                } else {
                                    console.error(`Method ${methodName} is not a function in context`);
                                    return;
                                }
                            } else {
                                if (chainAction.express){
                                    result = result[chainAction.method](...chainParams)(req, res, next);
                                } else {
                                    result = result[chainAction.method](...chainParams);
                                }
                            }
                        }
                    }
                }
            } else {
                console.error(`Method ${chainAction.method} is not a function on ${action.module}`);
                return;
            }
        }
    }

    return result;
}

async function processConfig(config, initialContext) {
    const context = { ...initialContext };
    for (const [key, value] of Object.entries(config.modules)) {
            let newPath = await downloadAndPrepareModule(value, context);
    }
    return context;
}

async function downloadAndPrepareModule(moduleName, context) {
    const modulePath = `/tmp/node_modules/${moduleName}`;
    if (!local.fs.existsSync(modulePath)) {
        await downloadAndUnzipModuleFromS3(moduleName, modulePath);
    }
    process.env.NODE_PATH = process.env.NODE_PATH ? `${process.env.NODE_PATH}:${modulePath}` : modulePath;
    return modulePath;
}

async function downloadAndUnzipModuleFromS3(moduleName, modulePath) {
    const zipKey = `node_modules/${moduleName}.zip`;
    const params = {
        Bucket: "1var-node-modules",
        Key: zipKey,
    };
    try {
        const data = await local.s3.getObject(params).promise();
        await unzipModule(data.Body, modulePath);
    } catch (error) {
        console.error(`Error downloading and unzipping module ${moduleName}:`, error);
        throw error;
    }
}

async function unzipModule(zipBuffer, modulePath) {
    local.fs.mkdirSync(modulePath, { recursive: true });
    const directory = await local.unzipper.Open.buffer(zipBuffer);
    await directory.extract({ path: modulePath });
}

module.exports = local.dyRouter;






