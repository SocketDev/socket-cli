#!/usr/bin/env node

import shadowNpxBin from './shadow/npx/bin.mts'

void (async () => {
  process.exitCode = 1

  const { spawnPromise } = await shadowNpxBin(process.argv.slice(2), {
    stdio: 'inherit',
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
