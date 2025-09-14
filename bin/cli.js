#!/usr/bin/env node
'use strict'

void (async () => {
  const Module = require('node:module')
  const path = require('node:path')
  const rootPath = path.join(__dirname, '..')
  Module.enableCompileCache?.(path.join(rootPath, '.cache'))

  const { default: constants } = require(
    path.join(rootPath, 'dist/constants.js'),
  )
  const { spawn } = require(
    path.join(rootPath, 'external/@socketsecurity/registry/lib/spawn.js'),
  )

  process.exitCode = 1

  const spawnPromise = spawn(
    constants.execPath,
    [
      ...constants.nodeNoWarningsFlags,
      ...constants.nodeDebugFlags,
      ...constants.nodeHardenFlags,
      ...constants.nodeMemoryFlags,
      ...(constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD
        ? ['--require', constants.instrumentWithSentryPath]
        : []),
      constants.distCliPath,
      ...process.argv.slice(2),
    ],
    {
      env: {
        ...process.env,
        ...constants.processEnv,
      },
      stdio: 'inherit',
    },
  )

  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (typeof code === 'number') {
      // eslint-disable-next-line n/no-process-exit
      process.exit(code)
    }
  })

  await spawnPromise
})()
