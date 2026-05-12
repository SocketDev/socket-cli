#!/usr/bin/env node

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { spawnSfw } from './utils/dlx/spawn.mjs'

const logger = getDefaultLogger()

export async function runYarnCli() {
  process.exitCode = 1

  // Forward to sfw (Socket Firewall).
  // Auto-detects SEA vs npm CLI mode (VFS extraction vs dlx download).
  const { spawnPromise } = await spawnSfw(['yarn', ...process.argv.slice(2)], {
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

/* c8 ignore start - direct CLI invocation only runs when file is the entrypoint */
if (import.meta.url === `file://${process.argv[1]}`) {
  runYarnCli().catch(error => {
    logger.error('Socket yarn wrapper error:', error)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}
/* c8 ignore stop */
