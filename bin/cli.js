#!/usr/bin/env node
'use strict'

const process = require('node:process')

const constants = require('../dist/constants.js')
const { spawn } = require('../external/@socketsecurity/registry/lib/spawn.js')

const { INLINED_SOCKET_CLI_SENTRY_BUILD } = constants

process.exitCode = 1

spawn(
  // Lazily access constants.execPath.
  constants.execPath,
  [
    // Lazily access constants.nodeHardenFlags.
    ...constants.nodeHardenFlags,
    // Lazily access constants.nodeNoWarningsFlags.
    ...constants.nodeNoWarningsFlags,
    // Lazily access constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD].
    ...(constants.ENV[INLINED_SOCKET_CLI_SENTRY_BUILD]
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
      // eslint-disable-next-line n/no-process-exit
      process.exit(code)
    }
  })
