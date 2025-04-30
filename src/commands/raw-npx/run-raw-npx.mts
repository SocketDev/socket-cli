import { spawn } from '@socketsecurity/registry/lib/spawn'

import { getNpxBinPath } from '../../shadow/npm/paths.mts'

export async function runRawNpx(
  argv: string[] | readonly string[]
): Promise<void> {
  const spawnPromise = spawn(getNpxBinPath(), argv as string[], {
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
