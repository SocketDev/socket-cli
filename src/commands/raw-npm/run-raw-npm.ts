import { spawn } from '@socketsecurity/registry/lib/spawn'

import { getNpmBinPath } from '../../shadow/npm/paths'

export async function runRawNpm(
  argv: string[] | readonly string[]
): Promise<void> {
  const spawnPromise = spawn(getNpmBinPath(), argv as string[], {
    stdio: 'inherit'
  })
  // See https://nodejs.org/api/all.html#all_child_process_event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (code !== null) {
      // eslint-disable-next-line n/no-process-exit
      process.exit(code)
    }
  })
  await spawnPromise
}
