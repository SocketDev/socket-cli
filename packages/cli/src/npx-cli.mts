#!/usr/bin/env node

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { spawnSfw } from './util/dlx/spawn.mjs'

const logger = getDefaultLogger()

export async function runNpxCli() {
  process.exitCode = 1

  // Forward to sfw (Socket Firewall).
  // Auto-detects SEA vs npm CLI mode (VFS extraction vs dlx download).
  const { spawnPromise } = await spawnSfw(['npx', ...process.argv.slice(2)], {
    // socket-hook: allow npx
    stdio: 'inherit',
  })

  // Wait for the spawn promise to resolve and handle the result.
  const result = await spawnPromise
  if (result.signal) {
    process.kill(process.pid, result.signal)
  } else if (typeof result.code === 'number') {
    process.exit(result.code)
  }
}

/* c8 ignore start - direct CLI invocation only runs when file is the entrypoint */
if (import.meta.url === `file://${process.argv[1]}`) {
  runNpxCli().catch(error => {
    logger.error('Socket pnpm exec wrapper error:', error)
    process.exit(1)
  })
}
/* c8 ignore stop */
