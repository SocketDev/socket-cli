import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { getNpmBinPath } from '../../utils/npm/paths.mts'

export async function runRawNpm(
  argv: string[] | readonly string[],
): Promise<void> {
  process.exitCode = 1

  const spawnPromise = spawn(getNpmBinPath(), argv as string[], {
    // On Windows, npm is often a .cmd file that requires shell execution.
    // The spawn function from @socketsecurity/registry will handle this properly
    // when shell is true.
    shell: constants.WIN32,
    stdio: 'inherit',
  })

  // See https://nodejs.org/api/child_process.html#event-exit.
  // @ts-ignore - process.on method exists at runtime
  spawnPromise.process.on?.(
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
