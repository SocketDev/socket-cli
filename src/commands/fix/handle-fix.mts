import { coanaFix } from './coana-fix.mts'
import { outputFixResult } from './output-fix-result.mts'

import type { FixConfig } from './types.mts'
import type { OutputKind } from '../../types.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

export type HandleFixConfig = Remap<
  FixConfig & {
    ghsas: string[]
    orgSlug: string
    outputKind: OutputKind
    unknownFlags: string[]
  }
>

export async function handleFix({
  autoMerge,
  cwd,
  ghsas,
  limit,
  minSatisfying,
  orgSlug,
  outputKind,
  prCheck,
  purls,
  rangeStyle,
  spinner,
  test,
  testScript,
  unknownFlags,
}: HandleFixConfig) {
  await outputFixResult(
    await coanaFix({
      autoMerge,
      cwd,
      ghsas,
      limit,
      minSatisfying,
      orgSlug,
      prCheck,
      purls,
      rangeStyle,
      spinner,
      test,
      testScript,
      unknownFlags,
    }),
    outputKind,
  )
}
