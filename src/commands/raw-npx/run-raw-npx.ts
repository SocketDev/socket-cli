import process from 'node:process'

import spawn from '@npmcli/promise-spawn'

import constants from '../../constants'
import { getNpxBinPath } from '../../shadow/npm-paths'

const { abortSignal } = constants

export async function runRawNpx(argv: ReadonlyArray<string>): Promise<void> {
  const spawnPromise = spawn(getNpxBinPath(), <string[]>argv, {
    signal: abortSignal,
    stdio: 'inherit'
  })
  // See https://nodejs.org/api/all.html#all_child_process_event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (abortSignal.aborted) {
      return
    }
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (code !== null) {
      process.exit(code)
    }
  })
  await spawnPromise
}
