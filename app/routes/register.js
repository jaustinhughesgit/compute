var express = require('express');
var router = express.Router();



module.exports = (dynamodb, passport) => {
 

    router.get('/', function(req, res, next) {
    res.render('register', { title: 'Register' });
    });

/*
    router.get('/google/callback',
        passport.authenticate('google', { failureRedirect: '/register' }),
        async (req, res) => {
            const email = req.user.emails[0].value;
            const firstName = req.user.name.givenName;
            const lastName = req.user.name.familyName;
            await registerOAuthUser(email, firstName, lastName, res);
        });

    router.get('/microsoft', passport.authenticate('microsoft', { scope: ['user.read'] }));

    router.get('/microsoft/callback',
        passport.authenticate('microsoft', { failureRedirect: '/register' }),
        async (req, res) => {
            const email = req.user._json.email;
            const firstName = req.user._json.givenName;
            const lastName = req.user._json.surname;
            await registerOAuthUser(email, firstName, lastName, res);
        });

    async function registerOAuthUser(email, firstName, lastName, res) {
        const params = { TableName: 'account', Key: { "email": email } };
        const coll = await dynamodb.get(params).promise();
    
        if (coll.hasOwnProperty("Item")) {
            res.send("Email already registered through another method.");
        } else {
            const uniqueId = uuidv4();
            const currentDate = new Date();
            const isoFormat = currentDate.toISOString();
            const item = {
                id: uniqueId,
                email: email,
                first: firstName,
                last: lastName,
                creationDate: isoFormat,
                // No password is saved for OAuth users
            };
    
            const insertParams = {
                TableName: 'account',
                Item: item
            };
            try {
                await dynamodb.put(insertParams).promise();
                res.send("Account Created!");
            } catch (error) {
                res.status(500).json({ error: "Error inserting into DynamoDB" });
            }
        }
    }
    */

    return router;
};