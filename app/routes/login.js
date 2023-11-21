var express = require('express');
var router = express.Router();

router.get('/', async function(req, res, next){
    const debug = require('debug')
    res.render('login', {title:'1 Var', message:JSON.stringify(debug)})
});


module.exports = router;