var express = require('express');
var router = express.Router();
const bodyParser = require('body-parser');

router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true })); 

module.exports = (passport, session, dynamodb) => {

    router.post('/', (req, res, next) => {
        console.log("login post", req)
        passport.authenticate('local', (err, user, info) => {
            if (err) return next(err);
    
            if (!user) return res.status(401).send(info.message); // Email not registered or password mismatch
    
            // log the user in
            req.logIn(user, function(err) {
                if (err) return next(err);

                return res.send("Logged In Successfully!");
            });
        })(req, res, next);
    });

    router.get('/', function(req, res, next) {
        console.log("login get", req)
        // Check if the user is already logged in using passport's method
        if (req.isAuthenticated()) {
            // If already logged in, redirect to the logout page
            res.redirect('/dashboard'); // replace '/logout' with your logout page route if different
        } else {
            // Otherwise, show the login page
            res.render('login', { title: 'Login' });
        }
    });

    return router;
};