import { outputScanReach } from './output-scan-reach.mts'
import { scanReachability } from './scan-reachability.mts'

import type { OutputKind } from '../../types.mts'

export async function handleScanReach(
  argv: string[] | readonly string[],
  cwd: string,
  outputKind: OutputKind,
) {
  const result = await scanReachability(argv, cwd)

  await outputScanReach(result, cwd, outputKind)
}
