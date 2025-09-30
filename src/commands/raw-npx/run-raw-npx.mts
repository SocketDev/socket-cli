import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { getNpxBinPath } from '../../utils/npm-paths.mts'

import type { ChildProcess } from 'node:child_process'

export async function runRawNpx(
  argv: string[] | readonly string[],
): Promise<void> {
  process.exitCode = 1

  const result = spawn(getNpxBinPath(), argv as string[], {
    // On Windows, npx is often a .cmd file that requires shell execution.
    // The spawn function from @socketsecurity/registry will handle this properly
    // when shell is true.
    shell: constants.WIN32,
    stdio: 'inherit',
  })
  // See https://nodejs.org/api/child_process.html#event-exit.
  ;(result.process as ChildProcess).on(
    'exit',
    (code: number | null, signalName: NodeJS.Signals | null) => {
      if (signalName) {
        process.kill(process.pid, signalName)
      } else if (typeof code === 'number') {
        // eslint-disable-next-line n/no-process-exit
        process.exit(code)
      }
    },
  )

  await result
}
