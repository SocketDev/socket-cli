import type { SpawnExtra } from '@socketsecurity/lib/spawn'
import { NPX } from '../../constants/agents.mts'

import type { ShadowBinOptions, ShadowBinResult } from '../npm-base.mts'
import shadowNpmBase from '../npm-base.mts'

export type { ShadowBinOptions, ShadowBinResult }

export default async function shadowNpxBin(
  args: string[] | readonly string[] = process.argv.slice(2),
  options?: ShadowBinOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  return await shadowNpmBase(NPX, args, options, extra)
}
