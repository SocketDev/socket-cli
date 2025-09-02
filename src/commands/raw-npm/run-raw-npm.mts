import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { getNpmBinPath } from '../../utils/npm-paths.mts'

export async function runRawNpm(
  argv: string[] | readonly string[],
): Promise<void> {
  const spawnPromise = spawn(getNpmBinPath(), argv as string[], {
    shell: constants.WIN32,
    stdio: 'inherit',
  })

  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (code) {
      // eslint-disable-next-line n/no-process-exit
      process.exit(code)
    }
  })

  await spawnPromise
}
