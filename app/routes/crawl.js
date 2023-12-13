var express = require('express');
var router = express.Router();

let changes = []

router.get('/', async function(req, res, next){
    res.render('crawl', {title:'crawl', content:JSON.stringify(changes)})
});


module.exports = router;