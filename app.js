// Create an app without express
const cacheManager = require('cache-manager')
const createRobot = require('probot/lib/robot')
const createApp = require('probot/lib/github-app')
const { findPrivateKey } = require('probot/lib/private-key')
const logger = require('probot/lib/logger')

const cache = cacheManager.caching({
  store: 'memory',
  ttl: 60 * 60
})

const app = createApp({
  id: process.env.APP_ID,
  cert: findPrivateKey()
})

const robot = createRobot({app, cache, logger, catchErrors: true})

// Setup Koa
const Koa = require('koa')
const hbs = require('koa-hbs')
const send = require('koa-send')
const jwt = require('jsonwebtoken')
const bodyParser = require('koa-bodyparser')
const server = new Koa()
const router = require('koa-router')()
server.use(bodyParser())
server.keys = [process.env.WEBHOOK_SECRET]

// Bring in that serverless-http magic
const serverless = require('serverless-http')

// Load OAuth routes
const oauth = require('./lib/oauth')
server.use(oauth.routes())

// Middlware functions
async function getInstallations (ctx, next) {
  let { installations } = (await ctx.state.github.users.getInstallations({})).data
  installations = installations.filter(installation => {
    return installation.account.type === 'Organization'
  })

  installations = await Promise.all(installations.map(async installation => {
    const github = await ctx.state.robot.auth(installation.id)
    try {
      const membership = (await github.orgs.getOrgMembership({
        org: installation.account.login,
        username: ctx.state.login
      })).data

      return membership.role === 'admin' ? installation : false
    } catch (err) {
      console.log(err)
      return false
    }
  }))

  installations = installations.filter(installation => installation)

  ctx.state.installations = installations
}

function findInstallation (ctx) {
  const installation = ctx.state.installations.find(i => {
    return i.account.login === ctx.params.owner
  })

  if (installation) {
    ctx.state.installation = installation
  } else {
    ctx.response.status = 404
    ctx.body = 'Not Found'
  }
}

// Setup all the routes!

router.use(hbs.middleware({
  viewPath: `${process.cwd()}/views`,
  partialsPath: `${process.cwd()}/views/partials`
}))

router.get('/static/*', async ctx => {
  await send(ctx, ctx.path, { root: './' })
})

router.get('/good-bye', ctx => {
  ctx.body = 'good-bye!'
})

router.use(async (ctx, next) => {
  const token = ctx.cookies.get('session')
  if (!token) {
    ctx.state.redirect = '/'
    return ctx.redirect('/github/login')
  }
  const github = await robot.auth()
  await github.authenticate({ type: 'token', token: ctx.cookies.get('session') })
  ctx.state.github = github
  ctx.state.robot = robot
  ctx.state.login = (await github.users.get({})).data.login
  await getInstallations(ctx, next)
  return next()
})

router.get('/', async (ctx, next) => {
  const { robot, installations } = ctx.state
  const info = (await (await robot.auth()).apps.get({})).data
  await ctx.render('index', {installations, info})
})

router.use('/:owner', async (ctx, next) => {
  findInstallation(ctx)
  return next()
})

router.get('/:owner', async ctx => {
  const { installation } = ctx.state
  if (installation) {
    await ctx.render('new', { installation })
  }
})

router.post('/:owner', async ctx => {
  const { installation } = ctx.state
  const options = {
    sub: installation.account.login,
    iss: installation.id,
    role: ctx.request.body.role
  }

  if (ctx.request.body.exp) {
    options.exp = Math.floor(Date.now() / 1000) + Number(ctx.request.body.exp)
  }

  const token = jwt.sign(options, process.env.WEBHOOK_SECRET)

  const link = `${ctx.protocol}://${ctx.host}/join/${token}`

  console.log({link, options}, 'Generating new token')
  ctx.body = link
})

router.get('/join/:token', async ctx => {
  const { robot, github } = ctx.state
  const options = jwt.verify(ctx.params.token, process.env.WEBHOOK_SECRET)
  console.log(options, 'Accepting invitation')

  const user = (await github.users.get({})).data

  console.log({user, options}, 'Adding user to Organization')

  const thisGitHub = await robot.auth(options.iss)

  await thisGitHub.orgs.addOrgMembership({
    org: options.sub,
    username: user.login,
    role: options.role
  })

  ctx.redirect(`https://github.com/orgs/${options.sub}/invitation`)
})

server.use(router.routes())

module.exports.handler = serverless(server)
