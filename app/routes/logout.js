var express = require('express');
var router = express.Router();

router.get('/', function(req, res, next){
    req.logout(function(err) {
        if (err) return next(err);  // Handle error during logout
        res.redirect('/login');    // Redirect to the login page
    });
});

module.exports = router;