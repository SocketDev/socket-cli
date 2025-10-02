#!/usr/bin/env node

/** @fileoverview Yarn CLI wrapper entry point. */

void (async () => {
  process.exitCode = 1

  // Use require to load from built dist path to avoid creating shadow-yarn-bin files.
  const shadowYarnBin = require('../dist/shadow-yarn-bin.js')

  const { spawnPromise } = await shadowYarnBin(process.argv.slice(2), {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env },
  })

  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on(
    'exit',
    (code: number | null, signalName: NodeJS.Signals | null) => {
      if (signalName) {
        process.kill(process.pid, signalName)
      } else if (typeof code === 'number') {
        // eslint-disable-next-line n/no-process-exit
        process.exit(code)
      }
    },
  )

  await spawnPromise
})()
