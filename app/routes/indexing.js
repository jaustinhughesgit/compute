var express = require('express');
var router = express.Router();

router.get('/', async function(req, res, next){
    res.render('indexing', {})
});

// Example Environment Variable: process.env.DB_CLUSTER_CONN_STR

module.exports = router;