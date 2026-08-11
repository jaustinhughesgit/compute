/**
 * Platform: Hosts the developer indexing page; canonical indexing behavior remains in Compute modules and data contracts.
 * Technical: Express GET route that renders `indexing`.
 */
var express = require('express');
var router = express.Router();

router.get('/', async function(req, res, next){
    res.render('indexing', {})
});

module.exports = router;
