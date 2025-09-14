#!/usr/bin/env node

import { spawn } from '@socketsecurity/registry/lib/spawn'

import shadowNpmBin from './shadow/npm/bin.mts'

const shadowBin = shadowNpmBin

process.exitCode = 1

const { spawnPromise } = await shadowBin('npx', process.argv.slice(2), {
  stdio: 'inherit',
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
