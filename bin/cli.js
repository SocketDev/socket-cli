#!/usr/bin/env node
'use strict'

const constants = require('../dist/constants')

const { DIST_TYPE, execPath } = constants

if (DIST_TYPE === 'require') {
  require(`../dist/require/cli.js`)
} else {
  const path = require('node:path')
  const spawn = require('@npmcli/promise-spawn')
  const { onExit } = require('signal-exit')

  const abortController = new AbortController()
  const { signal: abortSignal } = abortController

  // Detect ^C, i.e. Ctrl + C.
  onExit(() => {
    abortController.abort()
  })

  const spawnPromise = spawn(
    execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      path.join(constants.rootDistPath, DIST_TYPE, 'cli.js'),
      ...process.argv.slice(2)
    ],
    {
      stdio: 'inherit',
      signal: abortSignal
    }
  )
  spawnPromise.process.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
    } else if (code !== null) {
      process.exit(code)
    }
  })
}
