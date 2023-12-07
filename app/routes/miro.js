var express = require('express');
var router = express.Router();
const {Miro} = require('@mirohq/miro-api')
const session = require('express-session')
const miro = new Miro()

router.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  }),
)

router.get('/', async function(req, res, next){
    if (!(await miro.isAuthorized(req.session.id))) {
      res.redirect(miro.getAuthUrl())
      return
    }
  
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


router.get('/auth/miro/callback', async (req, res) => {
    await miro.exchangeCodeForAccessToken(req.session.id, req.query.code)
    res.redirect('/')
  })

module.exports = router;