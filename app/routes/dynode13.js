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

const json = [
    {
        //e:4,
        modules: {
             "passport":"passport",
             "passport-microsoft":"passport-microsoft"
         },
         actions: [
             {
                 next:true
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
                 params:["((accessToken))", "((refreshToken))", "((profile))", "((done))"], 
                 chain:[],
                 run:[
                     {access:"((done))", params:[null, "((profile))"]}
                 ],
                 assign:"callbackFunction"
             },
             {
                 target:"{{passport-microsoft}}",
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
                 target:"{{passport}}",
                 chain:[
                     {access:"initialize", params:[], express:true}
                 ],
                 assign:"passportInitialize"
             },
             {
                 next:true
             }
         ]
     },
     {
        modules: {
         },
         actions: [
             {
                 target:"{{passport}}",
                 chain:[
                     {access:"use", params:["{{passportmicrosoft}}"]}
                 ],
                 assign:"newStrategy"
             },
            {
                target:"{{passport}}",
                chain:[
                    {access:"session", params:[], express:true}
                ],
                assign:"passportSession"
            },
            {
                next:true
            }
         ]
        },
        {
           //e:21,
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
                 target:"{{passport}}",
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
                 target:"{{passport}}",
                 chain:[
                     {access:"deserializeUser", params:["{{deserializeFunction}}"]}
                 ],
                 assign:"deserializeUser"
             },
             {
                 target:"{{passport}}",
                 chain:[
                     {access:"use", params:["{{passportmicrosoft}}"]}
                 ],
                 assign:"newStrategy"
             },
             {
                ifs:[["{{urlpath}}","==","/microsoft"]],
                 target:"{{passport}}",
                 chain:[
                     {access:"authenticate", params:["microsoft", { scope: ['user.read'] }], express:true},
                 ],
                 assign:"newAuthentication"
             },
             {
                 params:["((err))", "((user))", "((info))"], 
                 chain:[],
                 run:[
                    {access:"user", params:["((user))"]},
                    {access:"next", params:[]}
                 ],

                 assign:"callbackFunction"
             },
             {
                ifs:[["{{urlpath}}","==","/microsoft/callback"]],
                 target:"{{passport}}",
                 chain:[
                     {access:"authenticate", params:["microsoft", { failureRedirect: '/' }, "{{callbackFunction}}"], express:true},
                 ],
                 assign:"newAuthentication"
             }
          ]
         },
         {
            //e:21,
            modules: {
             },
             actions: [

                {
                    set:{"user":{}}
                },
                {
                    params:["((err))"], 
                    chain:[],
                    run:[
                        {access:"user", params:[]},
                        {access:"next", params:[]}
                    ],
                    assign:"loginCallback"
                },
                {
                    target:"req",
                    chain:[
                        {access:"logIn", params:["{{user}}", "{{loginCallback}}"]}
                    ],
                    assign:"logIn"
                },
                {
                    ifs:[["{{urlpath}}","==","/goodbye"]],
                    target:"res",
                    chain:[
                        {access:"send", params:["{{}}"]}
                    ],
                    assign:"{{hello}}!"
                }
            ]
        },
        {
           //e:21,
           modules: {
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
                    ifs:[["{{urlpath}}","==","/hello"]],
                    target:"res",
                    chain:[
                        {access:"send", params:["{{}}"]}
                    ],
                    assign:"{{hello}}!"
                }
         ]
     }
]

let middlewareFunctions = json.map(stepConfig => {
    return async (req, res, next) => {
        lib.req = req;
        lib.res = res;
        lib.console = console;
        lib.context = await loadMods.processConfig(stepConfig, lib.context, lib);
        lib.context["urlpath"] = req.path
        lib.context["strategy"] = req.path.startsWith('/auth') ? req.path.split("/")[2] : "";
        await initializeModules(lib.context, stepConfig, req, res, next);
        console.log(lib)
    };
});

lib.dyRouter.all('/*', ...middlewareFunctions);

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
            result = moduleInstance;
        }
        result = await applyMethodChain(result, action, context, res, req, next);
        if (action.assign) {
            if (action.assign.includes('{{')) {
                let isFunctionExecution = action.assign.endsWith('!');
                let assignKey = isFunctionExecution ? action.assign.slice(2, -3) : action.assign.slice(2, -2);
                if (isFunctionExecution) {
                    if (typeof result === 'function'){
                        let tempFunction = () => result;
                        context[assignKey] = tempFunction();
                    } else {
                        context[assignKey] = result
                    }
                } else {
                    context[assignKey] = result;
                }
            } else {
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
                        }
                        if (runAction.subtract && typeof runAction.subtract === 'number'){
                            const contextKey = runAction.access.slice(2, -2); 
                            let val = replacePlaceholders(runAction.access, context);
                            if (typeof val === 'number') {
                                result = val - runAction.subtract; 
                            } else {
                                console.error(`'${contextKey}' is not a number or not found in context`);
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
                    } else if (runAction.access == "user") {
                        console.log("req",req)
                        console.log("res",res)
                        console.log("runAction", runAction)
                        console.log("runParams", runParams)
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
    let processedItem = item;
    if (typeof processedItem === 'string') {
        processedItem = processString(processedItem, context);
        console.log("processedItem", processedItem)
    } else if (Array.isArray(processedItem)) {
        processedItem =  processedItem.map(element => replacePlaceholders(element, context));
    }

    return processedItem;
}

function processString(str, context) {
    if (lib[str]) {
        console.log("lib", lib)
        console.log("str", str)
        return lib[str];
    }

    try {
        if (require.resolve("/tmp/node_modules/"+str)) {
            console.log("/tmp/node_modules/"+str)
            return require("/tmp/node_modules/"+str);
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