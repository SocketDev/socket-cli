import type { RangeStyle } from '../../utils/semver.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type FixConfig = {
  autopilot: boolean
  applyFixes: boolean
  cwd: string
  ghsas: string[]
  glob: string
  limit: number
  minimumReleaseAge: string
  minSatisfying: boolean
  orgSlug: string
  prCheck: boolean
  rangeStyle: RangeStyle
  spinner: Spinner | undefined
  unknownFlags: string[]
  outputFile: string
}
