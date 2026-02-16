#!/usr/bin/env node

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { spawnSfw } from './utils/dlx/spawn.mjs'

const logger = getDefaultLogger()

export default async function runNpxCli() {
  process.exitCode = 1

  // Forward to sfw (Socket Firewall).
  // Auto-detects SEA vs npm CLI mode (VFS extraction vs dlx download).
  const { spawnPromise } = await spawnSfw(['npx', ...process.argv.slice(2)], {
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
}

// Run if invoked directly (not as a module).
if (import.meta.url === `file://${process.argv[1]}`) {
  runNpxCli().catch(error => {
    logger.error('Socket npx wrapper error:', error)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}
