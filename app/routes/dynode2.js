var express = require('express');
var router = express.Router();

const json = {
    "modules": {
        "moment": "moment",
        "moment-timezone": "moment-timezone"
    },
    "actions": [
        {
            "module": "moment",
            "chain": [
                { "method": "tz", "params": ["Asia/Dubai"] },
                { "method": "format", "params": ["YYYY-MM-DD HH:mm:ss"] }
            ],
            "assignTo": "timeInDubai"
        },
        {
            "action": "var",
            "assignTo": "justTime",
            "valueFrom": "timeInDubai",
            "chain": [
                { "method": "format", "params": ["HH:mm"] }
            ]
        }
    ]
}


router.get('/', async function(req, res, next) {
    let context = processConfig(json);
    res.render('dynode2', { title: 'Dynode', result: JSON.stringify(context) });
});
function processConfig(config) {
    const context = {};

    // Load modules
    for (const [key, value] of Object.entries(config.modules)) {
        context[key] = require(value);
    }

    // Apply actions
    config.actions.forEach(action => {
        if (action.module) {
            let result = applyMethodChain(context[action.module], action);
            if (action.assignTo) {
                context[action.assignTo] = result;
            }
        } else if (action.action === 'var' && action.assignTo) {
            let result = action.valueFrom ? context[action.valueFrom] : undefined;
            result = applyMethodChain(result, action);
            context[action.assignTo] = result;
        }
        // Additional actions like 'if' can be added here
    });

    return context;
}

function applyMethodChain(target, action) {
    let result = target;

    // If there's an initial method to call on the module, do it first
    if (action.method && result) {
        result = result[action.method](...(action.params || []));
    }

    // Then apply any additional methods in the chain
    if (action.chain && result) {
        action.chain.forEach(chainAction => {
            if (typeof result[chainAction.method] === 'function') {
                result = result[chainAction.method](...(chainAction.params || []));
            } else {
                throw new TypeError(`Method ${chainAction.method} is not a function on the result object`);
            }
        });
    }

    return result;
}



module.exports = router;
