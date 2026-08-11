/**
 * Platform: Serves the Compute service landing page; execution enters through action routes instead.
 * Technical: Express GET route that renders `home` with no entity side effects.
 */
var express = require('express');
var router = express.Router();

router.get('/', async function(req, res, next){
    res.render('home', {title:'1 Var'})
});

module.exports = router;
