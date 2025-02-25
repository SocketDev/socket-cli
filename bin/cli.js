#!/usr/bin/env node
'use strict'

const process = require('node:process')

const constants = require('../dist/constants')

const { CLI, DIST_TYPE, SOCKET_CLI_SENTRY_BUILD } = constants

if (
  DIST_TYPE === 'require' &&
  // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
  !constants.ENV[SOCKET_CLI_SENTRY_BUILD]
) {
  // Lazily access constants.distPath.
  require(`${constants.distPath}/${CLI}.js`)
} else {
  const path = require('node:path')
  const spawn = require('@npmcli/promise-spawn')
  const { abortSignal } = constants

  process.exitCode = 1
  const spawnPromise = spawn(
    // Lazily access constants.execPath.
    constants.execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
      ...(constants.ENV[SOCKET_CLI_SENTRY_BUILD]
        ? [
            '--require',
            // Lazily access constants.instrumentWithSentryPath.
            constants.instrumentWithSentryPath
          ]
        : []),
      // Lazily access constants.distPath.
      path.join(constants.distPath, `${CLI}.js`),
      ...process.argv.slice(2)
    ],
    {
      signal: abortSignal,
      stdio: 'inherit'
    }
  )
  // See https://nodejs.org/api/all.html#all_child_process_event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (abortSignal.aborted) {
      return
    }
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (code !== null) {
      process.exit(code)
    }
  })
}
