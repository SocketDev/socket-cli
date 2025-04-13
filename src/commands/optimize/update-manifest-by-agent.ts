import { hasKeys, isObject } from '@socketsecurity/registry/lib/objects'

import constants from '../../constants'

import type { Overrides } from './types'
import type { Agent, EnvDetails } from '../../utils/package-environment'
import type { EditablePackageJson } from '@socketsecurity/registry/lib/packages'

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

const depFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
  'bundleDependencies'
]

function getEntryIndexes(
  entries: Array<[string | symbol, any]>,
  keys: Array<string | symbol>
): number[] {
  return keys
    .map(n => entries.findIndex(p => p[0] === n))
    .filter(n => n !== -1)
    .sort((a, b) => a - b)
}

function getLowestEntryIndex(
  entries: Array<[string | symbol, any]>,
  keys: Array<string | symbol>
) {
  return getEntryIndexes(entries, keys)?.[0] ?? -1
}

function getHighestEntryIndex(
  entries: Array<[string | symbol, any]>,
  keys: Array<string | symbol>
) {
  return getEntryIndexes(entries, keys).at(-1) ?? -1
}

function updatePkgJsonField(
  editablePkgJson: EditablePackageJson,
  field: string,
  value: any
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
            overrides: {
              ...(isPnpmObj ? (oldValue as any)[OVERRIDES] : {}),
              ...value
            }
          }
        })
      } else {
        // Properties with undefined values are omitted when saved as JSON.
        editablePkgJson.update(
          (hasKeys(oldValue)
            ? {
                [field]: {
                  ...(isPnpmObj ? oldValue : {}),
                  overrides: undefined
                }
              }
            : { [field]: undefined }) as typeof editablePkgJson.content
        )
      }
    } else if (field === OVERRIDES || field === RESOLUTIONS) {
      // Properties with undefined values are omitted when saved as JSON.
      editablePkgJson.update({
        [field]: hasKeys(value) ? value : undefined
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
    field === PNPM ? { [OVERRIDES]: value } : value
  ])
  editablePkgJson.fromJSON(
    `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`
  )
}

function updateOverridesField(pkgEnvDetails: EnvDetails, overrides: Overrides) {
  updatePkgJsonField(pkgEnvDetails.editablePkgJson, OVERRIDES, overrides)
}

function updateResolutionsField(
  pkgEnvDetails: EnvDetails,
  overrides: Overrides
) {
  updatePkgJsonField(pkgEnvDetails.editablePkgJson, RESOLUTIONS, overrides)
}

function updatePnpmField(pkgEnvDetails: EnvDetails, overrides: Overrides) {
  updatePkgJsonField(pkgEnvDetails.editablePkgJson, PNPM, overrides)
}

export type AgentModifyManifestFn = (
  pkgEnvDetails: EnvDetails,
  overrides: Overrides
) => void

export const updateManifestByAgent = new Map<Agent, AgentModifyManifestFn>([
  [BUN, updateResolutionsField],
  [NPM, updateOverridesField],
  [PNPM, updatePnpmField],
  [VLT, updateOverridesField],
  [YARN_BERRY, updateResolutionsField],
  [YARN_CLASSIC, updateResolutionsField]
])
