import constants from '../../constants.mts'
import { spawnCoana } from '../../utils/coana.mts'

import type { CResult } from '../../types.mts'

const { DOT_SOCKET_DOT_FACTS_JSON } = constants

export async function scanReachability(
  argv: string[] | readonly string[],
  cwd: string,
): Promise<CResult<unknown>> {
  return await spawnCoana(
    [
      'run',
      cwd,
      '--output-dir',
      cwd,
      '--socket-mode',
      DOT_SOCKET_DOT_FACTS_JSON,
      '--disable-report-submission',
      ...argv,
    ],
    { cwd },
  )
}
