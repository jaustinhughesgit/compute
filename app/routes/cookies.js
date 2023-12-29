var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');

async function getSub(val, key, dynamodb){
    let params
    if (key == "su"){
        params = { TableName: 'subdomains', KeyConditionExpression: 'su = :su', ExpressionAttributeValues: {':su': val} };
    } else if (key == "e"){
        params = { TableName: 'subdomains',IndexName: 'eIndex',KeyConditionExpression: 'e = :e',ExpressionAttributeValues: {':e': val} }
    } else if (key == "a"){
        params = { TableName: 'subdomains',IndexName: 'aIndex',KeyConditionExpression: 'a = :a',ExpressionAttributeValues: {':a': val} }
    }
    return await dynamodb.query(params).promise()
}

module.exports = function(privateKey, dynamodb, dynamodbLL) {
    var router = express.Router();
    const keyPairId = 'K2LZRHRSYZRU3Y'; 
    const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);
    router.get('/*', async function(req, res, next) {
        const reqPath = req.apiGateway.event.path
        const action = reqPath.split("/")[2]
        const fileID = reqPath.split("/")[3]

          const subdomainData = await getSub(fileID, "su", dynamodb);

          const attributeName = await getSub(subdomainData.Items[0].a, "a", dynamodb);

          const entityDetails = await getSub(subdomainData.Items[0].e, "e", dynamodb);

        console.log("entityDetails", entityDetails)
        console.log("subdomainData", subdomainData)
        console.log("attributeName", attributeName)
        console.log("fileID", fileID)

        const expires = 30000;
        const url = "https://public.1var.com/test.json";
        const policy = JSON.stringify({
            Statement: [
                {
                    Resource: url,
                    Condition: {
                        DateLessThan: { 'AWS:EpochTime': Math.floor((Date.now() + expires) / 1000) }
                    }
                }
            ]
        });
        if (req.type === 'url'){
            const signedUrl = signer.getSignedUrl({
                url: url,
                policy: policy
            });
            res.json({ signedUrl: signedUrl });
        } else {
            const cookies = signer.getSignedCookie({
                policy: policy
            });
            for (const cookieName in cookies) {
                res.cookie(cookieName, cookies[cookieName], { maxAge: expires, httpOnly: true, domain: '.1var.com', secure: true, sameSite: 'None' });
            }
            res.json({"ok":true,"entity":{"name":attributeName.Items[0].r}});
        }   
    });
    return router;
}