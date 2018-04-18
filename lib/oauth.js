const request = require('request')
const { promisify } = require('util')
const router = require('koa-router')()

const post = promisify(request.post)

router.get('/github/login', async ctx => {
  const host = ctx.headers['x-forwarded-host'] || ctx.host

  ctx.query = {
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `https://${host}/github/callback`
  }
  console.log('querystring:', ctx.querystring)
  const url = `https://github.com/login/oauth/authorize?${ctx.querystring}`
  console.log({url}, 'Redirecting to OAuth')
  ctx.redirect(url)
})

router.get('/github/callback', async ctx => {
  const tokenRes = await post({
    url: 'https://github.com/login/oauth/access_token',
    form: {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: ctx.query.code,
      state: ctx.query.state
    },
    json: true
  })

  if (tokenRes.statusCode === 200) {
    ctx.cookies.set('session', tokenRes.body.access_token)
    ctx.redirect(ctx.session.redirect || '/')
  } else {
    ctx.status(500)
    ctx.body = 'Invalid code'
  }
})

module.exports = router
