import {
  BUN,
  OVERRIDES,
  PNPM,
  RESOLUTIONS,
  VLT,
  YARN_BERRY,
  YARN_CLASSIC,
} from '@socketsecurity/lib/constants/agents'
import { hasKeys, isObject } from '@socketsecurity/lib/objects'

import { updatePnpmWorkspaceYamlOverrides } from './update-pnpm-workspace-yaml.mts'

import type { Overrides } from './types.mts'
import type { EnvDetails } from '../../util/ecosystem/environment.mjs'
import type { Agent } from '../../util/ecosystem/environment.mjs'
import type { EditablePackageJson } from '@socketsecurity/lib/packages'

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
    .sort((a, b) => a - b)
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

/**
 * Apply overrides to the host repo's manifest, picking the correct
 * destination based on agent + version:
 *   - pnpm 11+ → pnpm-workspace.yaml `overrides:` block (async write,
 *               preserves comments via the `yaml` package's Document API).
 *   - pnpm < 11 → package.json `pnpm.overrides`.
 *   - bun / yarn-classic / yarn-berry → package.json `resolutions`.
 *   - vlt / npm / fallback → package.json `overrides`.
 *
 * The `pkgEnvDetails` parameter carries `agentVersion` (a SemVer
 * instance) needed to disambiguate pnpm versions. Callers reach this
 * via `applyOptimization()` which already has the env in scope.
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
    // The field already exists so we simply update the field value.
    if (field === PNPM) {
      const isPnpmObj = isObject(oldValue)
      if (hasKeys(value)) {
        editablePkgJson.update({
          [field]: {
            ...(isPnpmObj ? oldValue : {}),
            [OVERRIDES]: value,
          },
        } as typeof editablePkgJson.content)
      } else if (isPnpmObj) {
        // Drop the overrides key but keep the rest of the pnpm config.
        const { overrides: _omitted, ...rest } = oldValue as Record<
          string,
          unknown
        >
        editablePkgJson.update({
          [field]: hasKeys(rest) ? rest : undefined,
        } as typeof editablePkgJson.content)
      } else {
        editablePkgJson.update({
          [field]: undefined,
        } as typeof editablePkgJson.content)
      }
    } else if (field === OVERRIDES || field === RESOLUTIONS) {
      // Properties with undefined values are deleted when saved as JSON.
      editablePkgJson.update({
        [field]: hasKeys(value) ? value : undefined,
      } as typeof editablePkgJson.content)
    } else {
      editablePkgJson.update({ [field]: value })
    }
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
  let insertIndex = -1
  let isPlacingHigher = false
  if (field === OVERRIDES) {
    insertIndex = getLowestEntryIndex(entries, [RESOLUTIONS])
    if (insertIndex === -1) {
      isPlacingHigher = true
      insertIndex = getHighestEntryIndex(entries, [...depFields, PNPM])
    }
  } else if (field === RESOLUTIONS) {
    isPlacingHigher = true
    insertIndex = getHighestEntryIndex(entries, [...depFields, OVERRIDES, PNPM])
  } else if (field === PNPM) {
    insertIndex = getLowestEntryIndex(entries, [OVERRIDES, RESOLUTIONS])
    if (insertIndex === -1) {
      isPlacingHigher = true
      insertIndex = getHighestEntryIndex(entries, depFields)
    }
  }
  if (insertIndex === -1) {
    insertIndex = getLowestEntryIndex(entries, ['engines', 'files'])
  }
  if (insertIndex === -1) {
    isPlacingHigher = true
    insertIndex = getHighestEntryIndex(entries, ['exports', 'imports', 'main'])
  }
  if (insertIndex === -1) {
    insertIndex = entries.length
  } else if (isPlacingHigher) {
    insertIndex += 1
  }
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
 * pnpm 11+ reads `overrides:` from `pnpm-workspace.yaml`. The
 * `pnpm.overrides` block in package.json is silently ignored. Returns
 * true when the host repo's `packageManager` field declares pnpm 11+,
 * meaning we should write to the YAML file instead of package.json.
 */
export function usesPnpmWorkspaceOverrides(
  pkgEnvDetails: Pick<EnvDetails, 'agent' | 'agentVersion'>,
): boolean {
  return pkgEnvDetails.agent === PNPM && pkgEnvDetails.agentVersion.major >= 11
}
