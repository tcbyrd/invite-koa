const createRobot = require('probot/lib/robot')
const createApp = require('probot/lib/github-app')
const { findPrivateKey } = require('probot/lib/private-key')

const serverless = require('serverless-http')
const Koa = require('koa')

const app = createApp({
    id: process.env.APP_ID,
    cert: findPrivateKey()
})

const robot = createRobot({app})

const server = new Koa()
const router = require('koa-router')()

server.use(async (ctx, next) => {
  ctx.request.robot = robot
  ctx.request.token = process.env.SESSION_TOKEN
  await next()
})

server.use(async (ctx, next) => {
  const {robot} = ctx.request
  const github = await robot.auth()
  github.authenticate({ type: 'token', token: ctx.request.token })
  ctx.request.github = github
  await next()
})

router.get('/hello', async ctx => {
  const {github} = ctx.request
  const user = await github.users.get({})
  ctx.body = JSON.stringify(user)
})

router.get('/good-bye', async ctx => {
  ctx.body = 'good-bye!'
})

server.use(router.routes())

module.exports.handler = serverless(server)
