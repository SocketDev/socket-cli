#!/usr/bin/env node
'use strict'

const constants = require('../dist/constants')

const { DIST_TYPE } = constants

if (DIST_TYPE === 'require') {
  require(`../dist/${DIST_TYPE}/cli.js`)
} else {
  const path = require('node:path')
  const spawn = require('@npmcli/promise-spawn')

  const { abortSignal, execPath, rootDistPath } = constants

  process.exitCode = 1
  const spawnPromise = spawn(
    execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      path.join(rootDistPath, DIST_TYPE, 'cli.js'),
      ...process.argv.slice(2)
    ],
    {
      signal: abortSignal,
      stdio: 'inherit'
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
