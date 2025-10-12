#!/usr/bin/env node

import shadowPnpmBin from './shadow/pnpm/bin.mts'

void (async () => {
  process.exitCode = 1

  const { spawnPromise } = await shadowPnpmBin(process.argv.slice(2), {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env },
  })

  // Wait for the spawn promise to resolve and handle the result.
  const result = await spawnPromise
  if (result.signal) {
    process.kill(process.pid, result.signal)
  } else if (typeof result.code === 'number') {
    // eslint-disable-next-line n/no-process-exit
    process.exit(result.code)
  }
})()
