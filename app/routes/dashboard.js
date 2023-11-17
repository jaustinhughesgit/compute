var express = require('express');
var router = express.Router();

router.get('/', async function(req, res, next){
    res.render('dashboard', {title:'1 Var'})
});


module.exports = router;