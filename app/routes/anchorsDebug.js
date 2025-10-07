

var express = require('express');
var router = express.Router();

router.get('/', async function(req, res, next){
    res.render('anchorsDebug', {})
});

module.exports = router;