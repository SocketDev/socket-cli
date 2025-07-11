import { outputScanReach } from './output-scan-reach.mts'
import constants from '../../constants.mts'
import { spawnCoana } from '../../utils/coana.mts'

const { DOT_SOCKET_DOT_FACTS_JSON } = constants

import type { OutputKind } from '../../types.mts'

export type HandleScanReachConfig = {
  cwd: string
  outputKind: OutputKind
  unknownFlags: string[]
}

export async function handleScanReach({
  cwd,
  outputKind,
  unknownFlags,
}: HandleScanReachConfig) {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Running reachability scan...')

  const result = await spawnCoana(
    [
      'run',
      cwd,
      '--output-dir',
      cwd,
      '--socket-mode',
      DOT_SOCKET_DOT_FACTS_JSON,
      '--disable-report-submission',
      ...unknownFlags,
    ],
    { cwd, spinner },
  )

  spinner.stop()

  await outputScanReach(result, outputKind)
}
