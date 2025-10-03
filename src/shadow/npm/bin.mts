/** @fileoverview npm shadow binary entry point for Socket CLI. Wraps npm commands with security scanning before package installation. */

import { NPM } from '../../constants.mts'
import shadowNpmBase from '../npm-base.mts'

import type { ShadowBinOptions, ShadowBinResult } from '../npm-base.mts'
import type { SpawnExtra } from '@socketsecurity/registry/lib/spawn'

export type { ShadowBinOptions, ShadowBinResult }

export default async function shadowNpmBin(
  args: string[] | readonly string[] = process.argv.slice(2),
  options?: ShadowBinOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  return await shadowNpmBase(NPM, args, options, extra)
}
