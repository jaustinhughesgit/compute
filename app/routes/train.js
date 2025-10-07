

// routes/artifacts.js
var express = require('express');
var router = express.Router();

  const cfg = {
    bucket: defaults.bucket || 'public.1var.com',
    artifactsPrefix: defaults.artifactsPrefix || 'artifacts/anchors_v1/_combined/',
    anchorSetId: defaults.anchorSetId || 'anchors_v1',
    K0: Number.isFinite(defaults.K0) ? defaults.K0 : 8,
    iters0: Number.isFinite(defaults.iters0) ? defaults.iters0 : 25,
    seed0: Number.isFinite(defaults.seed0) ? defaults.seed0 : 42,
    targetCellSize: Number.isFinite(defaults.targetCellSize) ? defaults.targetCellSize : 100,
    iters1: Number.isFinite(defaults.iters1) ? defaults.iters1 : 20,
    seed1: Number.isFinite(defaults.seed1) ? defaults.seed1 : 123
  };

  router.get('/train', (req, res) => {
    res.render('train', { cfg });
  });

  return router;

module.exports = router;