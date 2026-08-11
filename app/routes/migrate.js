/**
 * Platform: Hosts the operator migration page without defining a migration protocol itself.
 * Technical: Express GET route that renders `migrate`.
 */
var express = require('express');
var router = express.Router();

router.get('/', async function(req, res, next){
    res.render('migrate', {})
});

module.exports = router;
