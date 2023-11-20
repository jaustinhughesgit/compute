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
        }
    ]
}


router.get('/', async function(req, res, next) {
    let context = processConfig(json);
    res.render('dynode', { title: 'Dynode', time: JSON.stringify(context) });
});

function processConfig(config) {
    const context = {};

    // Load modules
    for (const [key, value] of Object.entries(config.modules)) {
        context[key] = require(value);
    }

    // Apply actions
    config.actions.forEach(action => {
        let result = context[action.module];

        if (action.method) {
            // If there's a method to call, call it on the module or the last result
            result = result[action.method](...(action.params || []));
        }

        if (action.chain) {
            // If there's a chain of methods, apply them in sequence
            action.chain.forEach(chainAction => {
                result = result[chainAction.method](...(chainAction.params || []));
            });
        }

        if (action.assignTo) {
            // Assign the final result to the context
            context[action.assignTo] = result;
        }
    });

    return context;
}


module.exports = router;
