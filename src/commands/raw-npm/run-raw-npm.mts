import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { getNpmBinPath } from '../../utils/npm-paths.mts'

export async function runRawNpm(
  argv: string[] | readonly string[]
): Promise<void> {
  const spawnPromise = spawn(getNpmBinPath(), argv as string[], {
    // Lazily access constants.WIN32.
    shell: constants.WIN32,
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
