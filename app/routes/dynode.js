var express = require('express');
var router = express.Router();

const json = {
    "modules": {
        "moment": "moment",
        "moment-timezone": "moment-timezone"
    },
    "momentConfig": {
        "timezone": "Asia/Dubai",
        "format": "YYYY-MM-DD HH:mm:ss"
    }
}

router.get('/', async function(req, res, next){
    let result = await processConfig(json)
    res.render('dynode', {title:result})
});

function processConfig(config) {
    const context = {};

    // Load modules
    for (const [key, value] of Object.entries(config.modules)) {
        context[key] = require(value);
    }

    // Create app
    const app = context[config.app.createWith]();
    context['app'] = app;

    // Apply configurations
    for (const action of config.app.use) {
        const targetModule = context[action.module];
        const method = action.method;
        const params = action.params ? action.params.map(p => transformParam(p, context)) : [];

        targetModule[method](...params);
    }

    // ... handle routes and other settings ...

    return context;
}

function transformParam(param, context) {
    if (typeof param === 'string' && param.startsWith("exports.")) {
        return eval(`(${param})`);
    }
    // ... handle other special param types ...
    return param;
}





module.exports = router;