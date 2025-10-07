// ./routes/anchors.js
var express = require('express');
var router = express.Router();

// Render the simple test page
router.get('/', async function(req, res) {
  res.render('anchorsDebug', {});
});

module.exports = router;
