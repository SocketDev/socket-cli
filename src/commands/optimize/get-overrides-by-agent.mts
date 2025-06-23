import constants from '../../constants.mts'

import type { NpmOverrides, Overrides, PnpmOrYarnOverrides } from './types.mts'
import type { Agent, EnvDetails } from '../../utils/package-environment.mts'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'

const {
  BUN,
  NPM,
  OVERRIDES,
  PNPM,
  RESOLUTIONS,
  VLT,
  YARN_BERRY,
  YARN_CLASSIC,
} = constants

function getOverridesDataBun(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = pkgJson?.[RESOLUTIONS] ?? ({} as PnpmOrYarnOverrides)
  return { type: YARN_BERRY, overrides }
}

// npm overrides documentation:
// https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides
function getOverridesDataNpm(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = pkgJson?.[OVERRIDES] ?? ({} as NpmOverrides)
  return { type: NPM, overrides }
}

// pnpm overrides documentation:
// https://pnpm.io/package_json#pnpmoverrides
function getOverridesDataPnpm(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides =
    (pkgJson as any)?.[PNPM]?.[OVERRIDES] ?? ({} as PnpmOrYarnOverrides)
  return { type: PNPM, overrides }
}

function getOverridesDataVlt(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = pkgJson?.[OVERRIDES] ?? ({} as NpmOverrides)
  return { type: VLT, overrides }
}

// Yarn resolutions documentation:
// https://yarnpkg.com/configuration/manifest#resolutions
function getOverridesDataYarn(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = pkgJson?.[RESOLUTIONS] ?? ({} as PnpmOrYarnOverrides)
  return { type: YARN_BERRY, overrides }
}

// Yarn resolutions documentation:
// https://classic.yarnpkg.com/en/docs/selective-version-resolutions
function getOverridesDataYarnClassic(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = pkgJson?.[RESOLUTIONS] ?? ({} as PnpmOrYarnOverrides)
  return { type: YARN_CLASSIC, overrides }
}

export type GetOverrides = (
  pkgEnvDetails: EnvDetails,
  pkgJson?: PackageJson | undefined,
) => GetOverridesResult

export type GetOverridesResult = { type: Agent; overrides: Overrides }

export const overridesDataByAgent = new Map<Agent, GetOverrides>([
  [BUN, getOverridesDataBun],
  [NPM, getOverridesDataNpm],
  [PNPM, getOverridesDataPnpm],
  [VLT, getOverridesDataVlt],
  [YARN_BERRY, getOverridesDataYarn],
  [YARN_CLASSIC, getOverridesDataYarnClassic],
] as ReadonlyArray<[Agent, GetOverrides]>)
