#!/usr/bin/env node
'use strict'

const process = require('node:process')

const constants = require('../dist/constants')

const { DIST_TYPE, SOCKET_CLI_SENTRY_BUILD } = constants

if (
  DIST_TYPE === 'require' &&
  // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
  !constants.ENV[SOCKET_CLI_SENTRY_BUILD]
) {
  // Lazily access constants.distCliPath.
  require(constants.distCliPath)
} else {
  process.exitCode = 1
  const { spawn } = require('@socketsecurity/registry/lib/spawn')
  spawn(
    // Lazily access constants.execPath.
    constants.execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
      ...(constants.ENV[SOCKET_CLI_SENTRY_BUILD]
        ? [
            '--require',
            // Lazily access constants.distInstrumentWithSentryPath.
            constants.distInstrumentWithSentryPath
          ]
        : []),
      // Lazily access constants.distCliPath.
      constants.distCliPath,
      ...process.argv.slice(2)
    ],
    {
      stdio: 'inherit'
    }
  )
    // See https://nodejs.org/api/all.html#all_child_process_event-exit.
    .process.on('exit', (code, signalName) => {
      if (signalName) {
        process.kill(process.pid, signalName)
      } else if (code !== null) {
        process.exit(code)
      }
    })
}
