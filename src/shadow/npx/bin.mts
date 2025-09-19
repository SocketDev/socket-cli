import { NPX } from '../../constants.mts'
import shadowNpmBin from '../npm/bin.mts'

import type { ShadowBinOptions, ShadowBinResult } from '../npm/bin.mts'
import type { SpawnExtra } from '@socketsecurity/registry/lib/spawn'

export type { ShadowBinOptions, ShadowBinResult }

export default async function shadowNpxBin(
  args: string[] | readonly string[] = process.argv.slice(2),
  options?: ShadowBinOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  return shadowNpmBin(NPX, args, options, extra)
}
