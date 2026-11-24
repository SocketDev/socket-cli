import type { FactsOnlyTypes } from '../../utils/coana.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { RangeStyle } from '../../utils/semver.mts'
import type { Spinner } from '../../utils/spinner.mts'

export type FixConfig = {
  all: boolean
  allowOverrides: boolean
  applyFixes: boolean
  autopilot: boolean
  coanaVersion: string | undefined
  cwd: string
  debug: boolean
  disableExternalToolChecks: boolean
  disableMajorUpdates: boolean
  // The ecosystems to generate Socket facts for; undefined when off.
  dynamicSbomInference: FactsOnlyTypes | undefined
  ecosystems: PURL_Type[]
  exclude: string[]
  excludePaths: string[]
  ghsas: string[]
  include: string[]
  minimumReleaseAge: string
  minSatisfying: boolean
  orgSlug: string
  outputFile: string
  packageManagers: string[]
  prCheck: boolean
  prLimit: number
  rangeStyle: RangeStyle
  showAffectedDirectDependencies: boolean
  silence: boolean
  spinner: Spinner | undefined
  unknownFlags: string[]
}
