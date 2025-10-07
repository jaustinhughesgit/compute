// routes/train.js
var express = require('express');
var router = express.Router();

/**
 * Mirrors artifacts.js style: export a ready router with defaults pulled from env.
 * Renders views/train.ejs at GET /anchors/train (when mounted at /anchors).
 */

const DEFAULT_S3_BUCKET           = process.env.ANCHOR_S3_BUCKET || 'public.1var.com';
const DEFAULT_ANCHOR_SET_ID       = process.env.ANCHOR_SET_ID || 'anchors_v1';
// Your actual artifacts live here:
const DEFAULT_ARTIFACTS_PREFIX    = process.env.ANCHORS_ARTIFACTS_PREFIX || 'artifacts/anchors_v1/_combined/';

// Lambda-friendly fast defaults (you can tweak via envs)
const DEFAULT_K0                  = Number(process.env.ANCHORS_K0 || 8);
const DEFAULT_ITERS0              = Number(process.env.ANCHORS_ITERS0 || 12);
const DEFAULT_SEED0               = Number(process.env.ANCHORS_SEED0 || 42);

const DEFAULT_TARGET_CELL_SIZE    = Number(process.env.ANCHORS_TARGET_CELL || 200);
const DEFAULT_ITERS1              = Number(process.env.ANCHORS_ITERS1 || 8);
const DEFAULT_SEED1               = Number(process.env.ANCHORS_SEED1 || 123);

// Optional: allow fast seeding method (fps) for short Lambda windows
const DEFAULT_METHOD              = (process.env.ANCHORS_METHOD || 'kmeans').toLowerCase(); // 'kmeans' | 'fps'

router.get('/train', async function(req, res) {
  res.render('train', {
    cfg: {
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
    }
  });
});

// Optional convenience: /anchors -> redirect to /anchors/train
router.get('/', (_req, res) => res.redirect('train'));

module.exports = router;
