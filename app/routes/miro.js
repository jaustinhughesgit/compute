var express = require('express');
var router = express.Router();
const { Miro } = require('@mirohq/miro-api');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const miro = new Miro();
router.use(cookieParser());
const JWT_SECRET = process.env.JWT_SECRET;

function verifyJWT(req, res, next) {
  const token = req.cookies.jwt;
  if (!token) {
    return res.redirect(miro.getAuthUrl());
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    console.log("req.userId = ", req.userId)
    next();
  } catch (ex) {
    return res.redirect(miro.getAuthUrl());
  }
}

router.get('/', verifyJWT, async function(req, res, next) {
    if (!(await miro.isAuthorized(req.session.id))) {
      res.redirect(miro.getAuthUrl());
      return;
    }
    res.redirect('/test')
});

router.get('/auth/miro/callback', async (req, res) => {
    await miro.exchangeCodeForAccessToken(req.session.id, req.query.code)
    const token = jwt.sign({ id: req.query.code }, JWT_SECRET, { expiresIn: '1h' });
    res.cookie('jwt', token, { httpOnly: true });
    res.contentType('html')
  res.write('List of boards available to the team 2:')
  const val = await miro.isAuthorized(req.session.id)
  res.write(val.toString("utf-8"))
  res.write('<ul>')
  const api = miro.as(req.session.id)
  for await (const board of api.getAllBoards()) {
    res.write(`<li><a href="${board.viewLink}">${board.name}</a></li>`)
  }
  res.write('</ul>')
  res.send()
});

router.get('/test', async (req, res) => {
    res.contentType('html')
    res.write('List of boards available to the team 3:')
    res.write('<ul>')
    const api = miro.as(req.session.id)
    for await (const board of api.getAllBoards()) {
    res.write(`<li><a href="${board.viewLink}">${board.name}</a></li>`)
    }
    res.write('</ul>')
    res.send()
});

module.exports = router;
