import constants from '../../constants'

import type { NpmOverrides, Overrides, PnpmOrYarnOverrides } from './types'
import type { Agent, EnvDetails } from '../../utils/package-environment'

const {
  BUN,
  NPM,
  OVERRIDES,
  PNPM,
  RESOLUTIONS,
  VLT,
  YARN_BERRY,
  YARN_CLASSIC
} = constants

function getOverridesDataBun(pkgEnvDetails: EnvDetails) {
  const overrides =
    pkgEnvDetails.editablePkgJson.content?.[RESOLUTIONS] ??
    ({} as PnpmOrYarnOverrides)
  return { type: YARN_BERRY, overrides }
}

// npm overrides documentation:
// https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides
function getOverridesDataNpm(pkgEnvDetails: EnvDetails) {
  const overrides =
    pkgEnvDetails.editablePkgJson.content?.[OVERRIDES] ?? ({} as NpmOverrides)
  return { type: NPM, overrides }
}

// pnpm overrides documentation:
// https://pnpm.io/package_json#pnpmoverrides
function getOverridesDataPnpm(pkgEnvDetails: EnvDetails) {
  const overrides =
    (pkgEnvDetails.editablePkgJson.content as any)?.[PNPM]?.[OVERRIDES] ??
    ({} as PnpmOrYarnOverrides)
  return { type: PNPM, overrides }
}

function getOverridesDataVlt(pkgEnvDetails: EnvDetails) {
  const overrides =
    pkgEnvDetails.editablePkgJson.content?.[OVERRIDES] ?? ({} as NpmOverrides)
  return { type: VLT, overrides }
}

// Yarn resolutions documentation:
// https://yarnpkg.com/configuration/manifest#resolutions
function getOverridesDataYarn(pkgEnvDetails: EnvDetails) {
  const overrides =
    pkgEnvDetails.editablePkgJson.content?.[RESOLUTIONS] ??
    ({} as PnpmOrYarnOverrides)
  return { type: YARN_BERRY, overrides }
}

// Yarn resolutions documentation:
// https://classic.yarnpkg.com/en/docs/selective-version-resolutions
function getOverridesDataYarnClassic(pkgEnvDetails: EnvDetails) {
  const overrides =
    pkgEnvDetails.editablePkgJson.content?.[RESOLUTIONS] ??
    ({} as PnpmOrYarnOverrides)
  return { type: YARN_CLASSIC, overrides }
}

export type GetOverrides = (pkgEnvDetails: EnvDetails) => GetOverridesResult

export type GetOverridesResult = { type: Agent; overrides: Overrides }

export const overridesDataByAgent = new Map<Agent, GetOverrides>([
  [BUN, getOverridesDataBun],
  [NPM, getOverridesDataNpm],
  [PNPM, getOverridesDataPnpm],
  [VLT, getOverridesDataVlt],
  [YARN_BERRY, getOverridesDataYarn],
  [YARN_CLASSIC, getOverridesDataYarnClassic]
] as ReadonlyArray<[Agent, GetOverrides]>)
