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

export function getOverridesDataBun(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = (pkgJson?.[RESOLUTIONS] ?? {}) as PnpmOrYarnOverrides
  return { type: YARN_BERRY, overrides }
}

// npm overrides documentation:
// https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides
export function getOverridesDataNpm(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = (pkgJson?.[OVERRIDES] ?? {}) as NpmOverrides
  return { type: NPM, overrides }
}

// pnpm overrides documentation:
// https://pnpm.io/package_json#pnpmoverrides
export function getOverridesDataPnpm(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = ((pkgJson as any)?.[PNPM]?.[OVERRIDES] ??
    {}) as PnpmOrYarnOverrides
  return { type: PNPM, overrides }
}

export function getOverridesDataVlt(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = (pkgJson?.[OVERRIDES] ?? {}) as NpmOverrides
  return { type: VLT, overrides }
}

// Yarn resolutions documentation:
// https://yarnpkg.com/configuration/manifest#resolutions
export function getOverridesDataYarn(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = (pkgJson?.[RESOLUTIONS] ?? {}) as PnpmOrYarnOverrides
  return { type: YARN_BERRY, overrides }
}

// Yarn resolutions documentation:
// https://classic.yarnpkg.com/en/docs/selective-version-resolutions
export function getOverridesDataYarnClassic(
  pkgEnvDetails: EnvDetails,
  pkgJson = pkgEnvDetails.editablePkgJson.content,
) {
  const overrides = (pkgJson?.[RESOLUTIONS] ?? {}) as PnpmOrYarnOverrides
  return { type: YARN_CLASSIC, overrides }
}

export type GetOverrides = (
  pkgEnvDetails: EnvDetails,
  pkgJson?: PackageJson | undefined,
) => GetOverridesResult

export type GetOverridesResult = { type: Agent; overrides: Overrides }

export function getOverridesData(
  pkgEnvDetails: EnvDetails,
  pkgJson?: PackageJson | undefined,
): GetOverridesResult {
  switch (pkgEnvDetails.agent) {
    case BUN:
      return getOverridesDataBun(pkgEnvDetails, pkgJson)
    case PNPM:
      return getOverridesDataPnpm(pkgEnvDetails, pkgJson)
    case VLT:
      return getOverridesDataVlt(pkgEnvDetails, pkgJson)
    case YARN_BERRY:
      return getOverridesDataYarn(pkgEnvDetails, pkgJson)
    case YARN_CLASSIC:
      return getOverridesDataYarnClassic(pkgEnvDetails, pkgJson)
    case NPM:
    default:
      return getOverridesDataNpm(pkgEnvDetails, pkgJson)
  }
}
