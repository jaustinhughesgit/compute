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
            "method": "tz", 
            "params": ["Asia/Dubai"],
            "assignTo": "timeInDubai"
        }
    ]
};

router.get('/', async function(req, res, next) {
    let context = processConfig(json);
    res.render('dynode', { title: 'Dynode', time: context.timeInDubai.format() });
});

function processConfig(config) {
    const context = {};

    // Load modules
    for (const [key, value] of Object.entries(config.modules)) {
        context[key] = require(value);
    }

    // Apply actions
    config.actions.forEach(action => {
        const targetModule = context[action.module];
        const result = targetModule(...(action.params || []));
        if (action.assignTo) {
            context[action.assignTo] = result;
        }
    });

    return context;
}

module.exports = router;
