// routes/anchorsDebug.js
const express = require('express');
const router = express.Router();

// Serves the debug page; uses your existing POST route at /debug/anchors-assign
router.get('/anchors', (req, res) => {
  res.render('debug-anchors', { postUrl: '/debug/anchors-assign' });
});

module.exports = router;