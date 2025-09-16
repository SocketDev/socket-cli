#!/usr/bin/env node

import { NPM } from './constants.mts'
import shadowNpmBin from './shadow/npm/bin.mts'

void (async () => {
  process.exitCode = 1

  const { spawnPromise } = await shadowNpmBin(NPM, process.argv.slice(2), {
    stdio: 'inherit',
  })

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
