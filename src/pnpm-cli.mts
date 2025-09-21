#!/usr/bin/env node

import shadowPnpmBin from './shadow/pnpm/bin.mts'

void (async () => {
  process.exitCode = 1

  const { spawnPromise } = await shadowPnpmBin(process.argv.slice(2), {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env },
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
