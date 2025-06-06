import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'

import type { CResult } from '../../types.mts'

const { DOT_SOCKET_DOT_FACTS_JSON } = constants

export async function scanReachability(
  argv: string[] | readonly string[],
  cwd: string,
): Promise<CResult<unknown>> {
  try {
    const result = await spawn(
      constants.execPath,
      [
        // Lazily access constants.nodeNoWarningsFlags.
        ...constants.nodeNoWarningsFlags,
        // Lazily access constants.coanaBinPath.
        constants.coanaBinPath,
        'run',
        cwd,
        '--output-dir',
        cwd,
        '--socket-mode',
        DOT_SOCKET_DOT_FACTS_JSON,
        '--disable-report-submission',
        ...argv,
      ],
      {
        cwd,
        env: {
          ...process.env,
          // Lazily access constants.ENV.SOCKET_CLI_API_TOKEN
          SOCKET_CLI_API_TOKEN: constants.ENV.SOCKET_CLI_API_TOKEN,
        },
      },
    )
    return { ok: true, data: result.stdout.trim() }
  } catch (e) {
    const message = (e as any)?.stdout ?? (e as Error)?.message
    return { ok: false, data: e, message }
  }
}
