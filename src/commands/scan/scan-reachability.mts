import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'

import type { CResult } from '../../types.mts'

const { DOT_SOCKET_DOT_FACTS_JSON } = constants

export async function scanReachability(cwd: string): Promise<CResult<unknown>> {
  try {
    const result = await spawn(
      constants.execPath,
      [
        // Lazily access constants.coanaBinPath.
        constants.coanaBinPath,
        'run',
        cwd,
        '--disable-report-submission',
        '--output-dir',
        cwd,
        '--socket-mode',
        `./${DOT_SOCKET_DOT_FACTS_JSON}`,
      ],
      { cwd },
    )
    return { ok: true, data: result.stdout.trim() }
  } catch (e) {
    return { ok: false, data: e, message: (e as Error)?.message }
  }
}
