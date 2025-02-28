import { readPackageJson } from '@socketsecurity/registry/lib/packages'

import constants from '../../constants'

import type {
  Agent,
  StringKeyValueObject
} from '../../utils/package-environment-detector'

type PackageJson = Awaited<ReturnType<typeof readPackageJson>>
type NpmOverrides = { [key: string]: string | StringKeyValueObject }
type PnpmOrYarnOverrides = { [key: string]: string }
type Overrides = NpmOverrides | PnpmOrYarnOverrides
type GetOverrides = (pkgJson: PackageJson) => GetOverridesResult
type GetOverridesResult = { type: Agent; overrides: Overrides }

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

function getOverridesDataBun(pkgJson: PackageJson) {
  const overrides = (pkgJson as any)?.[RESOLUTIONS] ?? {}
  return { type: YARN_BERRY, overrides }
}

// npm overrides documentation:
// https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides
function getOverridesDataNpm(pkgJson: PackageJson) {
  const overrides = (pkgJson as any)?.[OVERRIDES] ?? {}
  return { type: NPM, overrides }
}

// pnpm overrides documentation:
// https://pnpm.io/package_json#pnpmoverrides
function getOverridesDataPnpm(pkgJson: PackageJson) {
  const overrides = (pkgJson as any)?.pnpm?.[OVERRIDES] ?? {}
  return { type: PNPM, overrides }
}

function getOverridesDataVlt(pkgJson: PackageJson) {
  const overrides = (pkgJson as any)?.[OVERRIDES] ?? {}
  return { type: VLT, overrides }
}

// Yarn resolutions documentation:
// https://yarnpkg.com/configuration/manifest#resolutions
function getOverridesDataYarn(pkgJson: PackageJson) {
  const overrides = (pkgJson as any)?.[RESOLUTIONS] ?? {}
  return { type: YARN_BERRY, overrides }
}

// Yarn resolutions documentation:
// https://classic.yarnpkg.com/en/docs/selective-version-resolutions
function getOverridesDataClassic(pkgJson: PackageJson) {
  const overrides = (pkgJson as any)?.[RESOLUTIONS] ?? {}
  return { type: YARN_CLASSIC, overrides }
}

export const overridesDataByAgent = new Map<Agent, GetOverrides>([
  [BUN, getOverridesDataBun],
  [NPM, getOverridesDataNpm],
  [PNPM, getOverridesDataPnpm],
  [VLT, getOverridesDataVlt],
  [YARN_BERRY, getOverridesDataYarn],
  [YARN_CLASSIC, getOverridesDataClassic]
])
