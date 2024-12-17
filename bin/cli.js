#!/usr/bin/env node
'use strict'

const constants = require('../dist/constants')

const { DIST_TYPE, distPath } = constants

if (DIST_TYPE === 'require') {
  require(`${distPath}/cli.js`)
} else {
  const path = require('node:path')
  const spawn = require('@npmcli/promise-spawn')

  const { abortSignal, distPath, execPath } = constants

  process.exitCode = 1
  const spawnPromise = spawn(
    execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      path.join(distPath, 'cli.js'),
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
