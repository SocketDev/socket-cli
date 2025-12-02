import type { RangeStyle } from '../../utils/semver.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type FixConfig = {
  applyFixes: boolean
  autopilot: boolean
  coanaVersion: string | undefined
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
  prCheck: boolean
  rangeStyle: RangeStyle
  showAffectedDirectDependencies: boolean
  spinner: Spinner | undefined
  unknownFlags: string[]
}
