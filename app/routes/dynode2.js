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
                { "method": "tz", "params": ["Asia/Dubai"] }
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
    if (action.method && target) {
        target = target[action.method](...(action.params || []));
    }
    if (action.chain && target) {
        action.chain.forEach(chainAction => {
            target = target[chainAction.method](...(chainAction.params || []));
        });
    }
    return target;
}



module.exports = router;
