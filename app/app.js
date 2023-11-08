const express = require('express');
const serverless = require('serverless-http')
const app = express();
app.get('/', (req, res) => res.send('Hello World!'));
app.listen(3000, () => console.log('Example app listening on port 3000!'))
module.exports.handler = serverless(app);

console.log("v2")