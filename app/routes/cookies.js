var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');

module.exports = function(privateKey, dynamodb, dynamodbLL) {
    var router = express.Router();
    const keyPairId = 'K2LZRHRSYZRU3Y'; 
    const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);


    async function getSub(val, key){
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

    async function getEntity(e){
        params = { TableName: 'entities', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: {':e': e} };
        return await dynamodb.query(params).promise()
    }

    async function getWord(a){
        params = { TableName: 'words', KeyConditionExpression: 'a = :a', ExpressionAttributeValues: {':a': a} };
        return await dynamodb.query(params).promise()
    }

    router.get('/*', async function(req, res, next) {
        const reqPath = req.apiGateway.event.path
        const action = reqPath.split("/")[2]
        const fileID = reqPath.split("/")[3]

        const subBySU = await getSub(fileID, "su");
        //const subByA = await getSub(subBySU.Items[0].a, "a");
        //const subByE = await getSub(subBySU.Items[0].e, "e");

        const entity = await getEntity(subBySU.Items[0].e)
        const children = entity.Items[0].t

        const head = await getWord(entity.Items[0].a)

        let response = {}
        response[subBySU.Items[0].su] = {meta:{name:head.Items[0].r}, children:{}}

        if (children != [] && children != "" && children != undefined){
            for (const child of children) {
                const childEntity = await getEntity(child);
                const childSub = await getSub(child, "e")
                const childName = await getWord(childEntity.Items[0].a)
                response[subBySU.Items[0].su].children[childSub.Items[0].su] = {meta:{name:childName.Items[0].r}, children:{}}
            }
        } else {
            console.log("children is:", children)
        }

        console.log(children)
        console.log(response)
        console.log("subBySU", subBySU)
        //console.log("subByA", subByA)
        //console.log("subByE", subByE)
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
            res.json({"ok":true,"response":response});
        }   
    });
    return router;
}