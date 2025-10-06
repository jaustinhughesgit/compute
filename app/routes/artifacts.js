// routes/artifacts.js
var express = require('express');
var router = express.Router();

const DEFAULT_S3_BUCKET     = process.env.ANCHOR_S3_BUCKET || 'public.1var.com';
const DEFAULT_ANCHOR_SET_ID = process.env.ANCHOR_SET_ID || 'anchors_v1';
const DEFAULT_BAND_SCALE    = Number(process.env.BAND_SCALE || 2000);
const EMBPATHS_TABLE        = process.env.EMBPATHS_TABLE || 'embPaths';

router.get('/', async function(req, res) {
  res.render('artifacts', {
    embTable: EMBPATHS_TABLE,
    bucket: DEFAULT_S3_BUCKET,
    anchorSetId: DEFAULT_ANCHOR_SET_ID,
    bandScale: DEFAULT_BAND_SCALE
  });
});

module.exports = router;