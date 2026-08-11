

/**
 * Platform: Hosts the developer-facing anchor inspection page; it is not the anchor persistence contract.
 * Technical: Express GET route that renders the `anch` view.
 */
var express = require('express');
var router = express.Router();

router.get('/', async function(req, res, next){
    res.render('anch', {})
});

module.exports = router;
