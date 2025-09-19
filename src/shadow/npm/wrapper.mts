import { NPM } from '../../constants.mts'
import shadowNpmBinBase from './bin.mts'

import type { ShadowBinOptions, ShadowBinResult } from './bin.mts'
import type { SpawnExtra } from '@socketsecurity/registry/lib/spawn'

export type { ShadowBinOptions, ShadowBinResult }

export default async function shadowNpmBin(
  args: string[] | readonly string[] = process.argv.slice(2),
  options?: ShadowBinOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  return shadowNpmBinBase(NPM, args, options, extra)
}
