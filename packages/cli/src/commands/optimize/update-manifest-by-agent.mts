import {
  BUN,
  OVERRIDES,
  PNPM,
  RESOLUTIONS,
  VLT,
  YARN_BERRY,
  YARN_CLASSIC,
} from '@socketsecurity/lib-stable/constants/package-managers'
import {
  hasKeys,
  isObject,
} from '@socketsecurity/lib-stable/objects/predicates'

import { updatePnpmWorkspaceYamlOverrides } from './update-pnpm-workspace-yaml.mts'

import type { Overrides } from './types.mts'
import type { EnvDetails } from '../../util/ecosystem/environment.mjs'
import type { Agent } from '../../util/ecosystem/environment.mjs'
import type { EditablePackageJson } from '@socketsecurity/lib-stable/packages/types'

const depFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
  'bundleDependencies',
]

export function getEntryIndexes(
  entries: Array<[string | symbol, unknown]>,
  keys: Array<string | symbol>,
): number[] {
  return keys
    .map(n => entries.findIndex(p => p[0] === n))
    .filter(n => n !== -1)
    .toSorted((a, b) => a - b)
}

export function getHighestEntryIndex(
  entries: Array<[string | symbol, unknown]>,
  keys: Array<string | symbol>,
) {
  return getEntryIndexes(entries, keys)?.at(-1) ?? -1
}

export function getLowestEntryIndex(
  entries: Array<[string | symbol, unknown]>,
  keys: Array<string | symbol>,
) {
  return getEntryIndexes(entries, keys)?.[0] ?? -1
}

export function resolvePkgJsonInsertPosition(
  entries: Array<[string | symbol, unknown]>,
  field: string,
): { index: number; placeAfter: boolean } {
  let index = -1
  let placeAfter = false
  if (field === OVERRIDES) {
    index = getLowestEntryIndex(entries, [RESOLUTIONS])
    if (index === -1) {
      placeAfter = true
      index = getHighestEntryIndex(entries, [...depFields, PNPM])
    }
  } else if (field === RESOLUTIONS) {
    placeAfter = true
    index = getHighestEntryIndex(entries, [...depFields, OVERRIDES, PNPM])
  } else if (field === PNPM) {
    index = getLowestEntryIndex(entries, [OVERRIDES, RESOLUTIONS])
    if (index === -1) {
      placeAfter = true
      index = getHighestEntryIndex(entries, depFields)
    }
  }
  if (index === -1) {
    index = getLowestEntryIndex(entries, ['engines', 'files'])
  }
  if (index === -1) {
    placeAfter = true
    index = getHighestEntryIndex(entries, ['exports', 'imports', 'main'])
  }
  return {
    __proto__: null,
    index: index === -1 ? entries.length : index,
    placeAfter: index !== -1 && placeAfter,
  }
}

export function updateExistingPkgJsonField(
  editablePkgJson: EditablePackageJson,
  field: string,
  value: unknown,
): void {
  const oldValue = editablePkgJson.content[field]
  if (field === PNPM) {
    const isPnpmObj = isObject(oldValue)
    if (hasKeys(value)) {
      editablePkgJson.update({
        [field]: {
          ...(isPnpmObj ? oldValue : {}),
          [OVERRIDES]: value,
        },
      })
    } else if (isPnpmObj) {
      const { overrides: _omitted, ...rest } = oldValue as Record<
        string,
        unknown
      >
      editablePkgJson.update({
        [field]: hasKeys(rest) ? rest : undefined,
      })
    } else {
      editablePkgJson.update({ [field]: undefined })
    }
    return
  }
  if (field === OVERRIDES || field === RESOLUTIONS) {
    editablePkgJson.update({
      [field]: hasKeys(value) ? value : undefined,
    })
    return
  }
  editablePkgJson.update({ [field]: value })
}

/**
 * Apply overrides to the host repo's manifest, picking the correct destination
 * based on agent + version:
 *
 * - Pnpm 11+ → pnpm-workspace.yaml `overrides:` block (async write, preserves
 *   comments via the `yaml` package's Document API).
 * - Pnpm < 11 → package.json `pnpm.overrides`.
 * - Bun / yarn-classic / yarn-berry → package.json `resolutions`.
 * - Vlt / npm / fallback → package.json `overrides`.
 *
 * The `pkgEnvDetails` parameter carries `agentVersion` (a SemVer instance)
 * needed to disambiguate pnpm versions. Callers reach this via
 * `applyOptimization()` which already has the env in scope.
 */
export async function updateManifest(
  agent: Agent,
  pkgEnvDetails: EnvDetails,
  overrides: Overrides,
): Promise<void> {
  const { editablePkgJson } = pkgEnvDetails
  switch (agent) {
    case BUN:
      updateResolutionsField(editablePkgJson, overrides)
      return
    case PNPM:
      if (usesPnpmWorkspaceOverrides(pkgEnvDetails)) {
        // Route to pnpm-workspace.yaml. Also clear any stale
        // `pnpm.overrides` in package.json — pnpm 11 ignores it, but
        // leaving it there is misleading + drift-prone.
        updatePnpmField(editablePkgJson, {})
        await updatePnpmWorkspaceYamlOverrides(pkgEnvDetails.pkgPath, overrides)
      } else {
        updatePnpmField(editablePkgJson, overrides)
      }
      return
    case VLT:
      updateOverridesField(editablePkgJson, overrides)
      return
    case YARN_BERRY:
      updateResolutionsField(editablePkgJson, overrides)
      return
    case YARN_CLASSIC:
      updateResolutionsField(editablePkgJson, overrides)
      return
    default:
      updateOverridesField(editablePkgJson, overrides)
      return
  }
}

export function updateOverridesField(
  editablePkgJson: EditablePackageJson,
  overrides: Overrides,
) {
  updatePkgJsonField(editablePkgJson, OVERRIDES, overrides)
}

export function updatePkgJsonField(
  editablePkgJson: EditablePackageJson,
  field: string,
  value: unknown,
) {
  const oldValue = editablePkgJson.content[field]
  if (oldValue) {
    updateExistingPkgJsonField(editablePkgJson, field, value)
    return
  }
  if (
    (field === OVERRIDES || field === PNPM || field === RESOLUTIONS) &&
    !hasKeys(value)
  ) {
    return
  }
  // Since the field doesn't exist we want to insert it into the package.json
  // in a place that makes sense, e.g. close to the "dependencies" field. If
  // we can't find a place to insert the field we'll add it to the bottom.
  const entries = Object.entries(editablePkgJson.content)
  const position = resolvePkgJsonInsertPosition(entries, field)
  const insertIndex = position.index + (position.placeAfter ? 1 : 0)
  entries.splice(insertIndex, 0, [
    field,
    field === PNPM ? { [OVERRIDES]: value } : value,
  ])
  editablePkgJson.fromJSON(
    `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`,
  )
}

export function updatePnpmField(
  editablePkgJson: EditablePackageJson,
  overrides: Overrides,
) {
  updatePkgJsonField(editablePkgJson, PNPM, overrides)
}

export function updateResolutionsField(
  editablePkgJson: EditablePackageJson,
  overrides: Overrides,
) {
  updatePkgJsonField(editablePkgJson, RESOLUTIONS, overrides)
}

/**
 * Pnpm 11+ reads `overrides:` from `pnpm-workspace.yaml`. The `pnpm.overrides`
 * block in package.json is silently ignored. Returns true when the host repo's
 * `packageManager` field declares pnpm 11+, meaning we should write to the YAML
 * file instead of package.json.
 */
export function usesPnpmWorkspaceOverrides(
  pkgEnvDetails: Pick<EnvDetails, 'agent' | 'agentVersion'>,
): boolean {
  return pkgEnvDetails.agent === PNPM && pkgEnvDetails.agentVersion.major >= 11
}
