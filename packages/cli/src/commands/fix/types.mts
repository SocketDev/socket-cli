import type { OutputKind } from '../../types.mts'
import type { PURL_Type } from '../../utils/ecosystem/types.mts'
import type { RangeStyle } from '../../utils/semver.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'

export type FixConfig = {
  all: boolean
  applyFixes: boolean
  autopilot: boolean
  coanaVersion: string | undefined
  cwd: string
  disableMajorUpdates: boolean
  ecosystems: PURL_Type[]
  exclude: string[]
  ghsas: string[]
  include: string[]
  minimumReleaseAge: string
  minSatisfying: boolean
  orgSlug: string
  outputFile: string
  outputKind: OutputKind
  prCheck: boolean
  prLimit: number
  rangeStyle: RangeStyle
  showAffectedDirectDependencies: boolean
  spinner: Spinner | undefined
  unknownFlags: string[]
}
