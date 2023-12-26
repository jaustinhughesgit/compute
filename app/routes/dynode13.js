var express = require('express');
let lib = {};
lib.AWS = require('aws-sdk');
lib.dyRouter = express.Router();
lib.path = require('path');
lib.fs = require('fs');
lib.session = require('express-session');
lib.s3 = new lib.AWS.S3();
const { promisify } = require('util');
lib.exec = promisify(require('child_process').exec);
let loadMods = require('../scripts/processConfig.js')

lib.dyRouter.use(lib.session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } 
}));

const json1 = [
    {
        modules: {
             "passport":"passport",
             "passport-microsoft":"passport-microsoft"
         },
         actions: [
            {
                target:"passport",
                chain:[
                ],
                assign:"passport"
            },
            {
                target:"passport-microsoft",
                chain:[
                ],
                assign:"passport-microsoft"
            },
            {
                target:"passport-microsoft",
                chain:[
                    {access:"Strategy"}
                ],
                assign:"MicrosoftStrategy"
            },
            {
                target:"passport",
                chain:[
                    {access:"initialize", params:[], express:true, next:true}
                ],
                assign:"passportInitialize"
            }
        ]
    },
    {
       modules: {
        },
        actions: [

            {
                target:"passport",
                chain:[
                    {access:"session", params:[], express:true, next:true}
                ],
                assign:"passportSession"
            }
        ]
    },
    {
       modules: {
        },
        actions: [
            {
                params:["((user))", "((done))"], 
                chain:[],
                run:[
                    {access:"((done))", params:[null, "((user))"]}
                ],
                assign:"serializeFunction"
            },
            {
                target:"passport",
                chain:[
                    {access:"serializeUser", params:["{{serializeFunction}}"]}
                ],
                assign:"serializeUser"
            },
            {
                params:["((user))", "((done))"], 
                chain:[],
                "run":[
                    {access:"((done))", params:[null, "((user))"]}
                ],
                assign:"deserializeFunction"
            },
            {
                target:"passport",
                chain:[
                    {access:"deserializeUser", params:["{{deserializeFunction}}"]}
                ],
                assign:"deserializeUser"
            },
            {
                params:["((accessToken))", "((refreshToken))", "((profile))", "((done))"], 
                chain:[],
                run:[
                    {access:"((done))", params:[null, "((profile))"]}
                ],
                assign:"callbackFunction"
            },
            {
                target:"passport-microsoft",
                chain:[
                {access:"Strategy", params:[
                    {
                        clientID: process.env.MICROSOFT_CLIENT_ID,
                        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
                        callbackURL: "https://compute.1var.com/auth/microsoft/callback",
                        scope: ['user.read']
                    },"{{callbackFunction}}"
                ],
                    new:true}
                ],
                assign:"passportmicrosoft"
            },
            {
                target:"passport",
                chain:[
                    {access:"use", params:["{{passportmicrosoft}}"]}
                ],
                assign:"newStrategy"
            },
            {
                ifs:[["{{urlpath}}","==","/microsoft"]],
                target:"passport",
                chain:[
                    {access:"authenticate", params:["microsoft", { scope: ['user.read'] }], express:true, next:false},
                ],
                assign:"newAuthentication"
            },
            {
                "set":{"user":""}
            },
            {
                params:["((err))", "((user))", "((info))"], 
                chain:[],
                run:[
                   {access:"{{user}}", params:["((user))"]},
                   {access:"next", params:[]}
                ],

                assign:"callbackFunction"
            },
            {
               ifs:[["{{urlpath}}","==","/microsoft/callback"]],
                target:"{{passport}}",
                chain:[
                    {access:"authenticate", params:["microsoft", { failureRedirect: '/' }, "{{callbackFunction}}"], express:true, next:false},
                ],
                assign:"newAuthentication"
            },
            {
                target:"req",
                chain:[
                    {access:"isAuthenticated", params:[]}
                ],
                assign:"newAuth"
            },
            {
                ifs:[["{{urlpath}}","==","/hello"]],
                target:"res",
                chain:[
                    {access:"send", params:["{{}}"]}
                ],
                assign:"hello"
            },
        ]
    },
    {
       modules: {
        },
        actions: [
            {
                ifs:[["{{user}}","==",""]],
                target:"res",
                chain:[
                    {access:"json", params:[{"loggedIn":false}]}
                ]
            },
            {
                target:"res",
                chain:[
                    {access:"json", params:["{{user}}"]}
                ]
            }
        ]
    }
]

let middleware1 = json1.map(stepConfig => {
    return async (req, res, next) => {
        lib.req = req;
        lib.res = res;
        lib.context = await loadMods.processConfig(stepConfig, lib.context, lib);
        lib["urlpath"] = req.path
        lib.context["urlpath"] = req.path
        await initializeModules(lib.context, stepConfig, req, res, next);
    };
});

lib.dyRouter.all('/*', ...middleware1);

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
    console.log(5)
    console.log("left1", left)
    left = replacePlaceholders(left, context)
    console.log("left2",left)
    console.log("right1", right)
    right = replacePlaceholders(right, context)
    console.log("right2",right)
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
        console.log("getModuleInstance")
        let moduleInstance = replacePlaceholders(action.target, context);
        console.log("moduleInstance", moduleInstance)
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
            console.log(1)
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
            console.log("action/////", action)
            let result = createFunctionFromAction(action, context, req, res, next)
            console.log("result/////",result)
            if (isFunctionExecution) {
                if (typeof result === 'function'){
                    context[assignKey] =  result()
                } else {
                    context[assignKey] =  result;
                }
            } else {
                console.log("no !")
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

async function initializeModules(context, config, req, res, next) {
    require('module').Module._initPaths();
    for (const action of config.actions) {
        let runAction = true;
        if (action.if) {
            runAction = condition(action.if[0], action.if[1], action.if[2], action.if[3], context);
        } else if (action.ifs) {
            console.log(action.ifs)
            for (const ifObject of action.ifs) {
                console.log("ifObject", ifObject)
                runAction = condition(ifObject[0], ifObject[1], ifObject[2], ifObject[3], context);
                console.log("runAction",runAction)
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
                continue;
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
                const paramName = action.params[index].replace(/\(\(|\)\)/g, '');
                acc[paramName] = arg;
            }
            return acc;
        }, {});
        console.log("scope", scope)
        if (action.chain) {
            for (const chainAction of action.chain) {
                const chainParams = Array.isArray(chainAction.params) ? chainAction.params.map(param => {
                    return replaceParams(param, context, scope, args);
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
                        console.log("this is a function")
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
                            console.log("runAction.access.splice(2,-2)",runAction.access.slice(2,-2))
                            console.log("lib.context[runAction.access.splice(2,-2)]",lib.context[runAction.access.slice(2,-2)])
                            result = lib.context[runAction.access.slice(2,-2)]
                            console.log("runParams", runParams)
                            lib.context[runAction.access.slice(2,-2)] = runParams
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
                    }
                }
            }
        }
        return result;
    };
}

function replaceParams(param, context, scope, args) {
    if (param) {
        if (param.startsWith('((') && param.endsWith('))')) {
            const paramName = param.slice(2, -2);
            if (!isNaN(paramName)) {
                return args[paramName];
            }
            return scope[paramName] || context[paramName] || param;
        }
    }
    return param;
}

function replacePlaceholders(item, context) {
    console.log("item context", item, context)
    let processedItem = item;
    console.log("typeof processedItem", typeof processedItem)
    if (typeof processedItem === 'string') {
        console.log("processedItem typeof", processedItem)
        processedItem = processString(processedItem, context);
        console.log("processedItem", processedItem)
    } else if (Array.isArray(processedItem)) {
        console.log("Array.isArray(processedItem))",Array.isArray(processedItem))
        processedItem =  processedItem.map(element => replacePlaceholders(element, context));
    }
    console.log("returning")
    return processedItem;
}

function processString(str, context) {
    console.log("str",str)
    let tmpStr = "";
    if (str.startsWith('{{')) {
        tmpStr = str.slice(2, -2);
    } else {
        tempStr = str
    }

    if (lib[tempStr]) {
        console.log("lib", lib)
        console.log("str", tempStr)
        return lib[tempStr];
    }

    if (lib.context[tmpStr]){
        console.log("lib context found", tmpStr)
        console.log("lib.context[tmpStr]", lib.context[tmpStr])
        return lib.context[tmpStr]
    }

    try {
        console.log("resolve", require.resolve("/tmp/node_modules/"+tempStr))
        if (require.resolve("/tmp/node_modules/"+tempStr)) {
            console.log("/tmp/node_modules/"+tempStr)
            return require("/tmp/node_modules/"+tempStr);
        }
    } catch (e) {
        console.error(`Module '${str}' cannot be resolved:`, e);
    }


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
                        if (chainAction.access && chainAction.access.length != 0){
                            if (chainAction.access.startsWith('{{')) {
                                const methodFunction = replacePlaceholders(chainAction.access, context)
                                if (typeof methodFunction === 'function') {
                                    if (chainAction.express){
                                        if (chainAction.next || chainAction.next == undefined){
                                            result = methodFunction(...chainParams)(req, res, next);
                                        } else {
                                            result = methodFunction(...chainParams)(req, res);
                                        }
                                    } else {
                                        result = methodFunction(...chainParams);
                                    }
                                } else {
                                    console.error(`Method ${methodName} is not a function in context`);
                                    return;
                                }
                            } else {
                                if (chainAction.express){
                                    if (chainAction.next || chainAction.next == undefined){
                                    result = result[chainAction.access](...chainParams)(req, res, next);
                                    } else {
                                        result = result[chainAction.access](...chainParams)(req, res);
                                    }
                                } else {
                                    try{
                                    result = result[chainAction.access](...chainParams);
                                    } catch(err){
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

module.exports = lib.dyRouter;