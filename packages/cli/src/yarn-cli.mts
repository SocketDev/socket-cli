#!/usr/bin/env node

import { getDefaultLogger } from '@socketsecurity/lib-internal/logger'

import shadowYarnBin from './shadow/yarn/bin.mts'

import type { ChildProcess } from 'node:child_process'

const logger = getDefaultLogger()

export default async function runYarnCli() {
  process.exitCode = 1

  const { spawnPromise } = await shadowYarnBin(process.argv.slice(2), {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env },
  })

  // See https://nodejs.org/api/child_process.html#event-exit.
  ;(spawnPromise.process as ChildProcess).on(
    'exit',
    (code: number | null, signalName: string | null) => {
      if (signalName) {
        process.kill(process.pid, signalName)
      } else if (typeof code === 'number') {
        // eslint-disable-next-line n/no-process-exit
        process.exit(code)
      }
    },
  )

  await spawnPromise
}

// Run if invoked directly (not as a module).
if (import.meta.url === `file://${process.argv[1]}`) {
  runYarnCli().catch(error => {
    logger.error('Socket yarn wrapper error:', error)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}
