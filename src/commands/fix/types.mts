import type { RangeStyle } from '../../utils/semver.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type FixConfig = {
  autopilot: boolean
  cwd: string
  ghsas: string[]
  limit: number
  minSatisfying: boolean
  orgSlug: string
  prCheck: boolean
  rangeStyle: RangeStyle
  spinner: Spinner | undefined
  unknownFlags: string[]
}
