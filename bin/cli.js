#!/usr/bin/env node
'use strict'

const process = require('node:process')

const constants = require('../dist/constants')

const { DIST_TYPE } = constants

// When Node 18 is dropped and experimental-require-module warning are no longer
// a thing we can just use the require(`${constants.distPath}/cli.js`) code path.
if (DIST_TYPE === 'require') {
  // Lazily access constants.distPath.
  require(`${constants.distPath}/cli.js`)
} else {
  const path = require('node:path')
  const spawn = require('@npmcli/promise-spawn')
  const { abortSignal } = constants

  process.exitCode = 1
  const spawnPromise = spawn(
    // Lazily access constants.execPath
    constants.execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      // Lazily access constants.distPath.
      path.join(constants.distPath, 'cli.js'),
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
