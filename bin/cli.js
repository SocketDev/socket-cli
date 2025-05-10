#!/usr/bin/env node
'use strict'

const Module = require('node:module')

const constants = require('../dist/constants.js')
if (typeof Module.enableCompileCache === 'function') {
  // Lazily access constants.socketCachePath.
  Module.enableCompileCache(constants.socketCachePath)
}

// eslint-disable-next-line import-x/order
const process = require('node:process')
const { spawn } = require('../external/@socketsecurity/registry/lib/spawn.js')

const { INLINED_SOCKET_CLI_SENTRY_BUILD, NODE_COMPILE_CACHE } = constants

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
    env: {
      ...process.env,
      ...(NODE_COMPILE_CACHE ? { NODE_COMPILE_CACHE } : undefined)
    },
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
