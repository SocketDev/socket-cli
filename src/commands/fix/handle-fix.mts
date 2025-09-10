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
  autopilot,
  cwd,
  ghsas,
  limit,
  minSatisfying,
  orgSlug,
  outputKind,
  prCheck,
  rangeStyle,
  spinner,
  unknownFlags,
}: HandleFixConfig) {
  await outputFixResult(
    await coanaFix({
      autopilot,
      cwd,
      ghsas,
      limit,
      minSatisfying,
      orgSlug,
      prCheck,
      rangeStyle,
      spinner,
      unknownFlags,
    }),
    outputKind,
  )
}
