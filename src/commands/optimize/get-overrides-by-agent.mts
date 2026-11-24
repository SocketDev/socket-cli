import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { isMap, isScalar, parseDocument } from 'yaml'

import {
  BUN,
  NPM,
  OVERRIDES,
  PNPM,
  PNPM_WORKSPACE_YAML,
  RESOLUTIONS,
  VLT,
  YARN_BERRY,
  YARN_CLASSIC,
} from '../../constants.mts'
import { findUp } from '../../utils/fs.mts'
import { isRecord } from '../../utils/objects.mts'

import type { NpmOverrides, Overrides, PnpmOrYarnOverrides } from './types.mts'
import type { Agent, EnvDetails } from '../../utils/package-environment.mts'
import type { PackageJson } from '../../utils/packages.mts'
import type { Document } from 'yaml'

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

export async function readPnpmWorkspaceOverrides(pkgPath: string) {
  const filename =
    (await findUp(PNPM_WORKSPACE_YAML, { cwd: pkgPath })) ??
    path.join(pkgPath, PNPM_WORKSPACE_YAML)
  let source: string
  try {
    source = await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    // Keep a standalone project's workspace limited to the root package.
    source = 'packages: []\n'
  }
  const document: Document = parseDocument(source, { merge: true })
  if (document.errors.length > 0) {
    throw new Error(`Cannot read ${filename}: ${document.errors[0]!.message}`)
  }
  const root = document.contents
  if (isScalar(root) && root.value === null) {
    // YAML represents an explicit null or an empty document with a start
    // marker as a scalar. Replace the node while preserving its comments.
    const mapping = document.createNode({})
    mapping.comment = root.comment ?? null
    mapping.commentBefore = root.commentBefore ?? null
    mapping.spaceBefore = root.spaceBefore ?? false
    document.contents = mapping
  } else if (root !== null && !isMap(root)) {
    throw new Error(`Expected a YAML mapping in ${filename}`)
  }
  const config: unknown = document.toJS()
  const savedOverrides = isRecord(config) ? config[OVERRIDES] : undefined
  if (savedOverrides != null && !isRecord(savedOverrides)) {
    throw new Error(`Expected an overrides mapping in ${filename}`)
  }
  const originalOverrides = (savedOverrides ?? {}) as PnpmOrYarnOverrides
  const overrides = Object.assign(
    Object.create(null) as PnpmOrYarnOverrides,
    originalOverrides,
  )
  return { document, filename, originalOverrides, overrides, source }
}

export type PnpmWorkspaceOverrides = Awaited<
  ReturnType<typeof readPnpmWorkspaceOverrides>
>

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
