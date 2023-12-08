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

const json = [
    {
        modules: {
             "moment-timezone": "moment-timezone"
         },
         actions: [
             
            {
                 target:"req",
                 chain:[
                     {access:"isAuthenticated", params:[]}
                 ],
                 assign:"newAuth"
             },
             {
                 target:"console",
                 chain:[
                     {access:"log", params:["{{newAuth}}!"]}
                 ],
                 "assign":"logAuth"
             },
             {
                 ifs:[["{{newAuth}}"],["{{urlpath}}","==","/hello"]],
                 target:"res",
                 chain:[
                     {access:"send", params:["{{newAuth}}"]}
                 ],
                 assign:"{{hello}}!"
             },
             {
                 if:[10, [{ condition: '>', right: 5 },{ condition: '<', right: 20 }], null, "&&"],
                 set:{condition1:true}
             },
             {
                 if:[10, [{ condition: '>', right: 25 },{ condition: '<', right: 20 }], null, "&&"],
                 set:{condition2:true}
             },
             {
                if:[10, [{ condition: '>', right: 5 },{ condition: '<', right: 20 }], null, "&&"],
                set:{first:5}
            },
            {
               if:[10, [{ condition: '>', right: 5 },{ condition: '<', right: 20 }], null, "&&"],
               set:{second:0}
           },
            {
                while:["{{first}}", ">","{{second}}"],
                params:[],
                run:[
                    {access:"{{first}}", subtract:1, params:[]}
                ],
                assign:"{{first}}!"
            },
            {
                target: "moment-timezone",
                chain: [
                    { access: "tz", params: ["Asia/Dubai"] },
                    { access: "format", params: ["YYYY-MM-DD HH:mm:ss"] }
                ],
                assign: "timeInDubai"
            },
             {
                 target: "moment-timezone",
                 assign: "justTime",
                 from: ["{{timeInDubai}}!"],
                 chain: [
                     { access: "format", params: ["HH:mm"] }
                 ]
             },
             {
                 target: "moment-timezone",
                 assign: "timeInDubai2",
                 from: ["{{timeInDubai}}"],
                 chain: [
                     { access: "add", params: [1, "hours"] },
                     { access: "format", params: ["YYYY-MM-DD HH:mm:ss"] }
                 ]
             },
             {
                 next:true
             }
         ]
     },
     {
        modules: {
             "moment-timezone": "moment-timezone"
         },
         actions: [
 
             {
                 target: "moment-timezone",
                 assign: "justTime2",
                 from: ["{{timeInDubai2}}!"],
                 chain: [
                     { access: "format", params: ["HH:mm"] }
                 ]
             },
             {
                 target: "fs",
                 chain: [
                     {
                         access: "readFileSync",
                         params: ["/var/task/app/routes/../example.txt", "utf8"],
                     }
                 ],
                 assign: "fileContents"
             },
             {
                 target: "fs",
                 access: "writeFileSync",
                 params: [local.path.join('/tmp', 'tempFile.txt'), "This {{timeInDubai2}} is a test file content {{timeInDubai2}}", 'utf8']
             },
             {
                 target: "fs",
                 chain: [
                     {
                         access: "readFileSync",
                         params: [local.path.join('/tmp', 'tempFile.txt'), "utf8"],
                     }
                 ],
                 assign: "tempFileContents"
             },
             {
                 target: "s3",
                 chain: [
                     {
                         access: "upload",
                         params: [{
                             "Bucket": "public.1var.com",
                             "Key": "test.html",
                             "Body": "<html><head></head><body>Welcome to 1 VAR!</body></html>"
                         }]
                     },
                     {
                         access: "promise",
                         params: []
                     }
                 ],
                 assign: "s3UploadResult"
             },
             {
                 target: "s3",
                 chain: [
                     {
                         access: "getObject",
                         params: [{
                             Bucket: "public.1var.com",
                             Key: "test.html"
                         }]
                     },
                     {
                         access: "promise",
                         params: []
                     }
                 ],
                 assign: "s3Response"
             },
             {
                 target: "{{s3Response}}",
                 chain: [
                     {
                         access: "Body"
                     },
                     {
                         access: "toString",
                         params: ["utf-8"]
                     }
                 ],
                 assign: "{{s3Data}}"
             },
             {
                 ifs: [["{{urlpath}}", "==", "/test"]],
                 target: "res",
                 chain: [
                     {
                         access: "send",
                         params: ["{{s3Data}}"]
                     }
                 ]
             },
             {
                 next:true
             }
         ]
     },
     {
        modules: {
             "passport":"passport",
             "passport-microsoft":"passport-microsoft"
         },
         actions: [
             {
                 //"if":["{{urlpath}}","!=","/microsoft/callback"],
                 target:"passport",
                 chain:[
                 ],
                 assign:"passport"
             },
             {
                 //"if":["{{urlpath}}","!=","/microsoft/callback"],
                 params:["{accessToken}", "{refreshToken}", "{profile}", "{done}"], 
                 chain:[],
                 run:[
                     {access:"{done}", params:[null, "{profile}"]}
                 ],
                 assign:"callbackFunction"
             },
             {
                 //"if":["{{urlpath}}","!=","/microsoft/callback"],
                 target:"passport-microsoft",
                 chain:[
                 {access:"Strategy", params:[
                     {
                         clientID: process.env.MICROSOFT_CLIENT_ID,
                         clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
                         callbackURL: "https://compute.1var.com/auth/microsoft/callback",
                         resource: "https://graph.microsoft.com/",
                         tenant: process.env.MICROSOFT_TENANT_ID,
                         prompt: "login",
                         state: false,
                         type: "Web",
                         scope: ["user.read"]
                     },"{{callbackFunction}}"
                 ],
                     new:true}
                 ],
                 assign:"passportmicrosoft"
             },
             {
                 //"if":["{{urlpath}}","!=","/microsoft/callback"],
                 target:"{{passport}}",
                 chain:[
                     {access:"use", params:["{{passportmicrosoft}}"]}
                 ],
                 assign:"newStrategy"
             },
             {
                 //"if":["{{urlpath}}","!=","/microsoft/callback"],
                 params:["{user}", "{done}"], 
                 chain:[],
                 run:[
                     {access:"{done}", params:[null, "{user}"]}
                 ],
                 assign:"serializeFunction"
             },
             {
                 //"if":["{{urlpath}}","!=","/microsoft/callback"],
                 target:"{{passport}}",
                 chain:[
                     {access:"serializeUser", params:["{{serializeFunction}}"]}
                 ],
                 assign:"serializeUser"
             },
             {
                 //"if":["{{urlpath}}","!=","/microsoft/callback"],
                 params:["{user}", "{done}"], 
                 chain:[],
                 "run":[
                     {access:"{done}", params:[null, "{user}"]}
                 ],
                 assign:"deserializeFunction"
             },
             {
                 //"if":["{{urlpath}}","!=","/microsoft/callback"],
                 target:"{{passport}}",
                 chain:[
                     {access:"deserializeUser", params:["{{deserializeFunction}}"]}
                 ],
                 assign:"deserializeUser"
             },
             {
                 //"if":["{{urlpath}}","!=","/microsoft/callback"],
                 target:"{{passport}}",
                 chain:[
                     {access:"initialize", params:[]}
                 ],
                 assign:"passportInitialize"
             },
             {
                 target:"dyRouter",
                 chain:[
                     {access:"use", params:["{{passportInitialize}}"]}
                 ],
                 assign:"{{runDyRouterInit}}"
             },
             {
                 //"if":["{{urlpath}}","!=","/microsoft/callback"],
                 target:"{{passport}}",
                 chain:[
                     {access:"session", params:[]}
                 ],
                 assign:"passportSession"
             },
             {
                 target:"dyRouter",
                 chain:[
                     {access:"use", params:["{{passportSession}}"]}
                 ],
                 assign:"{{runDyRouterSession}}"
             },
             {
                 //"ifs":[["{{urlpath}}","!=","/microsoft/callback"]],
                 target:"{{passport}}",
                 chain:[
                     {access:"authenticate", params:["microsoft"], express:true},
                 ],
                 assign:"newAuthentication"
             }
         ]
     },
     {
        modules: {
             "passport":"passport",
             "passport-microsoft":"passport-microsoft"
         },
         actions: [
             {
                 //"ifs":[["{{urlpath}}","==","/microsoft/callback"]],
                 target:"req",
                 chain:[
                     {access:"isAuthenticated", params:[]}
                 ],
                 express:true,
                 assign:"{{isAuth}}"
             },
             {
                 ifs:[["{{urlpath}}","==","/microsoft/callback"]],
                 target:"res",
                 chain:[
                     {access:"json", params:["{{}}"]}
                 ],
                 assign:"{{getJson}}!"
             },
             {
                 ifs:[["{{urlpath}}","==","/hello"]],
                 target:"res",
                 chain:[
                     {access:"send", params:["Hello World!"]}
                 ],
                 assign:"hello"
             }
         ]
     }
]

let middlewareFunctions = json.map(stepConfig => {
    return async (req, res, next) => {
        local.req = req;
        local.res = res;
        local.console = console;
        local.context = await processConfig(stepConfig, local.context);
        local.context["urlpath"] = req.path
        local.context["strategy"] = req.path.startsWith('/auth') ? req.path.split("/")[2] : "";
        await initializeModules(local.context, stepConfig, req, res, next);
    };
});

local.dyRouter.all('/*', ...middlewareFunctions);

function condition(left, conditions, right, operator = "&&", context) {
    if (arguments.length === 1) {
        return !!left;
    }

    if (!Array.isArray(conditions)) {
        conditions = [{ condition: conditions, right: right }];
    }

    return conditions.reduce((result, cond) => {
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
    left = replacePlaceholders(left, context)
    right = replacePlaceholders(right, context)
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
        let moduleInstance = replacePlaceholders(action.target, context);
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
            if (args.length == 0) {
                result = moduleInstance;
            } else {
                result = moduleInstance(...args); 
            }
        } else {
            console.log("//else")
            result = moduleInstance;
        }
        result = await applyMethodChain(result, action, context, res, req, next);
        if (action.assign) {
            if (action.assign.includes('{{')) {
                let isFunctionExecution = action.assign.endsWith('!');
                let assignKey = isFunctionExecution ? action.assign.slice(2, -3) : action.assign.slice(2, -2);
                if (isFunctionExecution) {
                    context[assignKey] = typeof result === 'function' ? result() : result;
                } else {
                    context[assignKey] = result;
                }
            } else {
                console.log("result", result)
                context[action.assign] = result;
            }
        }
    } else if (action.assign && action.params) {
        if (action.assign.includes('{{')) {
            let isFunctionExecution = action.assign.endsWith('!');
            let assignKey = isFunctionExecution ? action.assign.slice(2, -3) : action.assign.slice(2, -2);
            let result = createFunctionFromAction(action, context, req, res, next)
            if (isFunctionExecution) {
                context[assignKey] = typeof result === 'function' ? result() : result;
            } else {
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

async function initializeModules(context, config, req, res, next) {
    require('module').Module._initPaths();
    for (const action of config.actions) {
        let runAction = true;
        if (action.if) {
            runAction = condition(action.if[0], action.if[1], action.if[2], action.if[3], context);
        } else if (action.ifs) {
            for (const ifObject of action.ifs) {
                runAction = condition(ifObject[0], ifObject[1], ifObject[2], ifObject[3], context);
                if (!runAction) {
                    break;
                }
            }
        }

        if (runAction) {
            if (action.set) {
                for (const key in action.set) {
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
                continue; // Skip to the next action in the loop
            }

            if (action.execute) {
                continue; 
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
            console.log("action.chain", action.chain)
            for (const chainAction of action.chain) {
                const chainParams = Array.isArray(chainAction.params) ? chainAction.params.map(param => {
                    return replaceParams(param, context, scope, args);
                }) : [];

                if (typeof chainAction.access === 'string') {
                    if (chainAction.access.startsWith('{') && chainAction.access.endsWith('}')) {
                        const methodName = chainAction.access.slice(1, -1);
                        if (typeof scope[methodName] === 'function') {
                            result = scope[methodName](...chainParams);
                        } else {
                            console.error(`Callback method ${methodName} is not a function`);
                            return;
                        }
                    } else if (result && typeof result[chainAction.access] === 'function') {
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
                const runParams = Array.isArray(runAction.params) ? runAction.params.map(param => {
                    return replaceParams(param, context, scope, args);
                }) : [];

                if (typeof runAction.access === 'string') {
                    if (runAction.access.startsWith('{{')) {
                        if (runAction.add && typeof runAction.add === 'number'){
                            const contextKey = runAction.access.slice(2, -2); // Extract the key without the curly braces
                            let val = replacePlaceholders(runAction.access, context);
                            if (typeof val === 'number') {
                                result = val + runAction.add; // Update the context with the new value
                            } else {
                                console.error(`'${contextKey}' is not a number or not found in context`);
                            }
                        }
                        if (runAction.subtract && typeof runAction.subtract === 'number'){
                            const contextKey = runAction.access.slice(2, -2); // Extract the key without the curly braces
                            let val = replacePlaceholders(runAction.access, context);
                            if (typeof val === 'number') {
                                result = val - runAction.subtract; // Update the context with the new value
                            } else {
                                console.error(`'${contextKey}' is not a number or not found in context`);
                            }
                        }
                    } else if (runAction.access.startsWith('{') && runAction.access.endsWith('}')) {
                        const methodName = runAction.access.slice(1, -1);
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
            if (!isNaN(paramName)) {
                return args[paramName];
            }
            return scope[paramName] || context[paramName] || param;
        }
    }
    return param;
}

function replacePlaceholders(item, context) {
    let processedItem = item;
    if (typeof processedItem === 'string') {
        processedItem = processString(processedItem, context);
    } else if (Array.isArray(processedItem)) {
        processedItem =  processedItem.map(element => replacePlaceholders(element, context));
    }

    return processedItem;
}

function processString(str, context) {
    if (local[str]) {
        return local[str];
    }

    try {
        if (require.resolve(str)) {
            return require(str);
        }
    } catch (e) {
        console.error(`Module '${str}' cannot be resolved:`, e);
    }

    let isFunctionExecution = str.endsWith('}}!');
    let processedString = str;
    if (isFunctionExecution) {
        processedString = str.slice(0, -1);
    }
    if (processedString.startsWith("{{") && processedString.endsWith("}}")) {
        const keyPath = processedString.slice(2, -2);
        let value = resolveValueFromContext(keyPath, context);
        if (isFunctionExecution && typeof value === 'function') {
            return value();
        }
        return value;
    }

    return str.replace(/\{\{([^}]+)\}\}/g, (match, keyPath) => {
        console.log("str", str)
        console.log(keyPath, context)
        return resolveValueFromContext(keyPath, context, true);
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
    console.log("target", target)
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
    console.log("action", action, "action.chain", action.chain)
    console.log(result)
    console.log(typeof result[action.access])
    if (action.chain && result) {
        console.log("action.chain", action.chain)
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
                        if (chainAction.access && chainAction.access.length != 0){
                            if (chainAction.access.startsWith('{{')) {
                                const methodFunction = replacePlaceholders(chainAction.access, context)
                                if (typeof methodFunction === 'function') {
                                    if (chainAction.express){
                                        result = methodFunction(...chainParams)(req, res, next);
                                    } else {
                                        result = methodFunction(...chainParams);
                                    }
                                } else {
                                    console.error(`Method ${methodName} is not a function in context`);
                                    return;
                                }
                            } else {
                                if (chainAction.express){
                                    result = result[chainAction.access](...chainParams)(req, res, next);
                                } else {
                                    result = result[chainAction.access](...chainParams);
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
console.log("result ==>", result)
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