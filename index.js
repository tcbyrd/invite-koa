const { serverless } = require('@probot/serverless-lambda')

const robot = (robot) => {
  robot.on('team.edited', async context => {
    context.log({context})
  })
}

module.exports.handler = serverless(robot)
