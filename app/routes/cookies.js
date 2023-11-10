var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');

// Your CloudFront key pair ID and private key
const keyPairId = 'APKAIXXXXXXX'; // Replace with your key pair ID
const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC3FezDz2dvkFWD
dx6MI6F0bCCGe6qmPTX5BREJQz+E4QMSM4WczjdKHZM5m4BTaAFgoiiQehuBgxHQ
EzcGivizZdgWBKpllauGly1eZcrC9qW5YAGvjyZpvoZY/+AvUo7YyqJqLm+fkD+s
MVRU1jKNkFr67K6dp6ujPikeR/YgAzFJ+wMLF78kJxnYQ7zCp1uFp2S/vkesc524
+ZgZsleRZgWzaNUbgqbY9/zR8r/kCoeCndf5fUzwpOvqpXzZIAYSKu9qRY3dmrLR
ApQKDOeioXPxx5aS4ZLLojaZD6vH+ts6qZ7hLrbBJdzdZR79NItRPG4y2YrNSSWq
N9E4qEQrAgMBAAECggEAATGdZ5wfRTT1uckPDpmKNfjL2tSiROSP84hll1/e4X5D
cjJFJBlGzFmWWivPZxEoi87C4POgNkn6gGwqUa/voIvWIDP2QHn8slX4r8LjfZNK
JVlLlC96GqUUDy8r8Q24F2XK2qe5hprUL3VAODAQCFLxT5g3fe5X9NU07hjzW+YR
P57NySs2OO/7r6aZsBQitvHjf7hWKzHCCqPXuax/J7E6CLCctvj1kw/iGiBCs7Wm
fZYNlcF7LwsiqkOvagzm98AH1NCCQd4UOlCcYsK7Yp9oZXdh5CgDI3QzqxfDGPNa
MKeOtaQ4G+vFGXZnHKp1hgZ4zR46c0RAZyvzthSWoQKBgQD3fRfBwZZdk44HpUze
WihihRgJBgfACDne/lEHGFeDbVIug+HDD9LfhCg9MyHff1HIH+rBiLGb6jOVvsTH
9dej8Tk8d8wTIIOy+TuAgIUyBH1LZcKRKO3KYWHeyc8wUlJjQs8iEhnwRQtaYqQC
NqlgV5xt8NUjOJfSEQA/HDckQwKBgQC9YdLWRVA5I3H1Q5EGVqE+PuaOR/1JOHAe
V0h/UrHLpAxqmvjZlURrEAtbXxkRIp0SHUgm7fXcpGeG2v5z8qs3zazbk55g9ACT
xoBdzFrkVPrPwt3eJuo4j2OdUvzfrObi/zGIeKixoh3kYxcIkOKEi2ZlJXGxXltC
XxhKNDmV+QKBgAY0WaMe4lEoQNhKOZodcoO9yHN5djpHOoQvpgJihtchp3zJC6Dj
Rasa2hNms8OxonA89JqzfZhmD7MCXFaTADv48TFl43TbTNHw06AOGMi/OhDo1S7k
csmvFVALiSkx9yTL6Pt2rrXKVVWHwYrYqfhjWeWbsww2AABhMrtiTrOXAoGALv1H
t/yoxBSkYOur3zu9dFldEW6RTQqg3xZfGaBmFxYUMptTJYGg4UOw3bIB4TuKZ4U2
ctpWR7HPMinCOvi6PPVeb3j4Miw4vHHjReK/pqnjNYuvS0CymugRGmcN8V3QSABz
xN3TVYfZDOL9QxXX7nU8KdqZlB3KXPSFbVv58dkCgYAygG0v7hT8ACisvqcjyzdY
jhIQ2ubnvZJrCr64a/nzPsaLaxj5SxFzRW2zXfUPAJuBZr/Q3B1dpxH9BdB32Nek
wdIYGINzkqa3jYsDur0SFWAj+3YOjN1+nCuWIiR5knjWYiFK09dq48DDfRF6mVbY
aecD41EAJBNUGok69mzbGQ==
-----END PRIVATE KEY-----`; // Replace with your private key

// Create a CloudFront signer
const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);

router.get('/', async function(req, res, next) {
    // Set the policy for the signed cookies
    const twoMinutes = 30000; // .5 minutes in milliseconds
    const policy = JSON.stringify({
        Statement: [
            {
                Resource: 'https://d1y7wzqctzeac0.cloudfront.net/*', // The URL pattern to allow
                Condition: {
                    DateLessThan: { 'AWS:EpochTime': Math.floor((Date.now() + twoMinutes) / 1000) }
                }
            }
        ]
    });

    // Generate signed cookies
    const cookies = signer.getSignedCookie({
        policy: policy
    });

    // Set the signed cookies in the response
    for (const cookieName in cookies) {
        res.cookie(cookieName, cookies[cookieName], { maxAge: twoMinutes, httpOnly: true });
    }

    res.render('cookies', { title: 'Test' });
});

module.exports = router;
