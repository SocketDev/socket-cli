import type { RangeStyle } from '../../utils/semver.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type FixConfig = {
  autoMerge: boolean
  cwd: string
  ghsas: string[]
  limit: number
  minSatisfying: boolean
  orgSlug: string
  prCheck: boolean
  purls: string[]
  rangeStyle: RangeStyle
  spinner: Spinner | undefined
  test: boolean
  testScript: string
  unknownFlags: string[]
}
