#!/usr/bin/env node

import { getDefaultLogger } from '@socketsecurity/lib-internal/logger'

import shadowNpmBin from './shadow/npm/bin.mts'

const logger = getDefaultLogger()

export default async function runNpmCli() {
  process.exitCode = 1

  const { spawnPromise } = await shadowNpmBin(process.argv.slice(2), {
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
}

// Run if invoked directly (not as a module).
if (import.meta.url === `file://${process.argv[1]}`) {
  runNpmCli().catch(error => {
    logger.error('Socket npm wrapper error:', error)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}
