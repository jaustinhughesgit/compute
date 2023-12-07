var express = require('express');
var router = express.Router();
const { Miro } = require('@mirohq/miro-api');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const miro = new Miro();

// Use cookie-parser middleware
router.use(cookieParser());

// JWT secret key
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware to verify JWT
function verifyJWT(req, res, next) {
  const token = req.cookies.jwt;
  if (!token) {
    // Redirect to Miro authorization if no token is found
    return res.redirect(miro.getAuthUrl());
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (ex) {
    // Redirect to Miro authorization if token is invalid
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
    console.log("req.query", req.query)
    console.log("req.query.code", req.query.code)
    await miro.exchangeCodeForAccessToken(req.session.id, req.query.code)

    // Create JWT
    const token = jwt.sign({ id: req.query.code }, JWT_SECRET, { expiresIn: '1h' });

    // Set the JWT in a cookie
    res.cookie('jwt', token, { httpOnly: true });


    res.contentType('html')
  res.write('List of boards available to the team 2:')
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
