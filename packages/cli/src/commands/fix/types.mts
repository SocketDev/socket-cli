import type { OutputKind } from '../../types.mts'
import type { RangeStyle } from '../../utils/semver.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'

export type FixConfig = {
  all: boolean
  applyFixes: boolean
  autopilot: boolean
  cwd: string
  disableMajorUpdates: boolean
  exclude: string[]
  ghsas: string[]
  include: string[]
  limit: number
  minimumReleaseAge: string
  minSatisfying: boolean
  orgSlug: string
  outputFile: string
  outputKind: OutputKind
  prCheck: boolean
  rangeStyle: RangeStyle
  showAffectedDirectDependencies: boolean
  spinner: Spinner | undefined
  unknownFlags: string[]
}
