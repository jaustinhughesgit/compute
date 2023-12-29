var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');

async function getEntity(e, dynamodb){
    const params = {
        TableName: 'entities',
        KeyConditionExpression: 'e = :e',
        ExpressionAttributeValues: {
          ':e': subdomainData.Items[0].e
        }
      };
      const entityDetails = await dynamodb.query(params).promise()
}



module.exports = function(privateKey, dynamodb, dynamodbLL) {
    var router = express.Router();
    const keyPairId = 'K2LZRHRSYZRU3Y'; 
    const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);
    router.get('/*', async function(req, res, next) {
        const reqPath = req.apiGateway.event.path
        const action = reqPath.split("/")[2]
        const fileID = reqPath.split("/")[3]

        const params = {
            TableName: 'subdomains',
            KeyConditionExpression: 'su = :su',
            ExpressionAttributeValues: {
              ':su': fileID
            }
          };
          const subdomainData = await dynamodb.query(params).promise()

          const params2 = {
            TableName: 'words',
            KeyConditionExpression: 'a = :a',
            ExpressionAttributeValues: {
              ':a': subdomainData.Items[0].a
            }
          };
          const attributeName = await dynamodb.query(params2).promise()

          const entityDetails = await getEntity(subdomainData.Items[0].e, dynamodb)

        console.log("entityDetails", entityDetails)
        console.log("subdomainData", subdomainData)
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