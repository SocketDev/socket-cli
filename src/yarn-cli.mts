#!/usr/bin/env node

import shadowYarnBin from './shadow/yarn/bin.mts'

void (async () => {
  process.exitCode = 1

  const { spawnPromise } = await shadowYarnBin(process.argv.slice(2), {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env },
  })

  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on('exit', (code: number | null, signalName: string | null) => {
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (typeof code === 'number') {
      // eslint-disable-next-line n/no-process-exit
      process.exit(code)
    }
  })

  await spawnPromise
})()
