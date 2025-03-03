import process from 'node:process'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { getNpmBinPath } from '../../shadow/npm-paths'

export async function runRawNpm(argv: ReadonlyArray<string>): Promise<void> {
  const spawnPromise = spawn(getNpmBinPath(), argv.slice(0), {
    stdio: 'inherit'
  })
  // See https://nodejs.org/api/all.html#all_child_process_event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (code !== null) {
      process.exit(code)
    }
  })
  await spawnPromise
}
