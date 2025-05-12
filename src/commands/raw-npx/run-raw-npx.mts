import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { getNpxBinPath } from '../../utils/npm-paths.mts'

export async function runRawNpx(
  argv: string[] | readonly string[]
): Promise<void> {
  const spawnPromise = spawn(getNpxBinPath(), argv as string[], {
    // Lazily access constants.WIN32.
    shell: constants.WIN32,
    stdio: 'inherit'
  })
  // See https://nodejs.org/api/child_process.html#event-exit.
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
