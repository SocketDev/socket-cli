#!/usr/bin/env node

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import shadowNpxBin from './shadow/npx/bin.mts'

const logger = getDefaultLogger()

export default async function runNpxCli() {
  process.exitCode = 1

  const { spawnPromise } = await shadowNpxBin(process.argv.slice(2), {
    stdio: 'inherit',
  })

  // Wait for the spawn promise to resolve and handle the result.
  const result = await spawnPromise
  if (result.signal) {
    process.kill(process.pid, result.signal)
  } else if (typeof result.code === 'number') {
    console.log(
      `process.exit called at npx-cli.mts:22 with code ${result.code}`,
    )
    // eslint-disable-next-line n/no-process-exit
    process.exit(result.code)
  }
}

// Run if invoked directly (not as a module).
if (import.meta.url === `file://${process.argv[1]}`) {
  runNpxCli().catch(error => {
    logger.error('Socket npx wrapper error:', error)
    console.log('process.exit called at npx-cli.mts:31')
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}
