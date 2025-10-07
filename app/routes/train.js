// routes/train.js
var express = require('express');
var router = express.Router();

const DEFAULT_S3_BUCKET        = process.env.ANCHOR_S3_BUCKET || 'public.1var.com';
const DEFAULT_ANCHOR_SET_ID    = process.env.ANCHOR_SET_ID || 'anchors_v1';
const DEFAULT_ARTIFACTS_PREFIX = process.env.ANCHORS_ARTIFACTS_PREFIX || 'artifacts/anchors_v1/_combined/';

const DEFAULT_K0               = Number(process.env.ANCHORS_K0 || 8);
const DEFAULT_ITERS0           = Number(process.env.ANCHORS_ITERS0 || 12);
const DEFAULT_SEED0            = Number(process.env.ANCHORS_SEED0 || 42);

const DEFAULT_TARGET_CELL_SIZE = Number(process.env.ANCHORS_TARGET_CELL || 200);
const DEFAULT_ITERS1           = Number(process.env.ANCHORS_ITERS1 || 8);
const DEFAULT_SEED1            = Number(process.env.ANCHORS_SEED1 || 123);

const DEFAULT_METHOD           = (process.env.ANCHORS_METHOD || 'kmeans').toLowerCase(); // 'kmeans' | 'fps'

const cfg = {
  bucket: DEFAULT_S3_BUCKET,
  artifactsPrefix: DEFAULT_ARTIFACTS_PREFIX,
  anchorSetId: DEFAULT_ANCHOR_SET_ID,
  K0: DEFAULT_K0,
  iters0: DEFAULT_ITERS0,
  seed0: DEFAULT_SEED0,
  targetCellSize: DEFAULT_TARGET_CELL_SIZE,
  iters1: DEFAULT_ITERS1,
  seed1: DEFAULT_SEED1,
  method: DEFAULT_METHOD
};

function renderTrain(req, res) {
  res.render('train', { cfg });
}

// Serve the page at both /train and / (under the /train mount)
router.get('/', renderTrain);
router.get('/train', renderTrain);

module.exports = router;
