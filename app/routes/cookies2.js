var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');

// Your CloudFront key pair ID and private key
const keyPairId = 'APKAXZ7FJUVFX7SYUO77'; // Replace with your key pair ID 123
const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAyqcY3cxlKen6cQhkdMdY6rmT8NmKOsC1gC3pdj37jowCKa0u
UV5uyotiGDOOKAcuT6GA7btPUtJ+sexhFeZFCWOA+uHP+LqHCyRFieozkBWZm5PP
o3iTuz7rQXBLNokC1o41cPHmRFtFWRrp5lsiZx61pFdQ6XPBACuHcTZK7cMo24Xt
wSnhzXXwy/jnd4p+X6VsoWJy8EaHupR00cs6JcLmOTVPJrddJFVV29DZ9Ht88Wxq
Z7+C+Qr8soOJz/D7bzJHcwDUEoDp75vjByfjTpS0Q5bvWD8XXAiuDOmR8sQa9+Cf
Ph4mykvTDiWPiSiqc9rt8v2lJLiizIu8HwaOZQIDAQABAoIBAAM5xVcOdakaTNQM
w/s/NbvyvUHvAdjCkCux+g6EQ7ihTjgsm1lMjVXoVw+Mjog2PmH3xPjDwP+lUxfw
68YF9suvS50dXV/s/tD0wFicI5BOZQtevxuFLqYjL7/IZ6IUFzlOuoIJj6vp31Y2
QUqF4SvOsinOAVSIn6X+4LaIHImL851RqtMpsud/RdKQi4ZArYt1Sg0278i66qcg
gwNwND+35TYwAOtLBid3855BjA9jVE9eo7GzNmETeXl7ijcAEGNOJoA2dqueqOxA
2lWhC8TbifmK0OSacVj4X2LDrPI8CzJq2SYHIpVf+MpuV2+FfQF6ITY0/OUjnfuY
l8elJMcCgYEA69JVau7+XHFQ6IQRs1G0YMUW5kZ6uuW/1JbooQdtTT2kExi1so+P
kQ5KdqIbDix1FxopHCDIApDVjMr/Yq+vZx5XlOPTS9Es5HNHhyheS7ICKC5mjRqD
cRxXwrNUIAwjFFIMeiKrYV6tB/PNMur5p4YXeyEsUVyNv2pfFrDxEb8CgYEA2/4z
ImCAAZHDchdN4m+ndM/5MUekw524i8gikdRLGxpks3L77MP/PHvxKi/k6xYsWKmr
q3LLePlcm6NfFsF19dCzpMSvbANSqUZlJc2t4uSv9JCuDD71nktgLMyKrVotVWRV
vo7CvxQJlh5xlu+DgaYcxWXpmPSVSHBOv02LoNsCgYA6Ryyc1Js/tTFNhPXq3tI4
5/wUxG4oKgcSPokW4oL8h7M4lO6yRhAwxNtaHg2ZnxsArpJiRSeomqprtO8QMGKk
lTcHsJXTMsppWqPenvdOtZsa2vy0+kxpc5usniy4DsfMicpTlKXN1lvkjzey0acI
43aCE1ykbr8JAvyk2u14eQKBgQCLR4DwPtBMLhDjZsW0mqQWXKWUAZvbDTwNo4Pf
d9ylKCyhQCcnW194169z2ibAf6VL7P/26BLSYG21S9Wj/o/ENYHGy4+UfvYSnbLk
IDf68nZEDGVk82dl9KrLMiSKZBFXgtKWdqPtfa4kENoxiSplJtoIT+F5KUBqQFBa
5amFCQKBgG3BYOqWK6OvyHtlXtU42t7p4rHn/UxBcSC3HAIqaG+0uRIulINMXgdY
lTKQv68uE/g5Q/TJakS84cH8+Y1MsONSO/7ePfEkhYKge9esPqm4T01pbTFnLQTy
pRleuzod+Uyss2+pgG2FiI/DjbWBIBE9Pn2zhPiCchUE7DCMb341
-----END RSA PRIVATE KEY-----`; // Replace with your private key 123

// Create a CloudFront signer
const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);

router.get('/', async function(req, res, next) {
    // Set the policy for the signed cookies
    const twoMinutes = 30000; // .5 minutes in milliseconds
    const policy = JSON.stringify({
        Statement: [
            {
                Resource: 'https://d37vus6tk1h6ib.cloudfront.net/test5.txt', // The URL pattern to allow
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
        res.cookie(cookieName, cookies[cookieName], { maxAge: twoMinutes, httpOnly: true, domain: '*.1var.com', secure: true, sameSite: 'None' });
    }

    res.render('cookies2', { title: 'Test' });
});

module.exports = router;
