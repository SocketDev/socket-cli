import { hasKeys, isObject } from '@socketsecurity/registry/lib/objects'

import constants from '../../constants'

import type {
  Agent,
  StringKeyValueObject
} from '../../utils/package-environment-detector'
import type { EditablePackageJson } from '@socketsecurity/registry/lib/packages'

type NpmOverrides = { [key: string]: string | StringKeyValueObject }
type PnpmOrYarnOverrides = { [key: string]: string }
type Overrides = NpmOverrides | PnpmOrYarnOverrides
type AgentModifyManifestFn = (
  pkgJson: EditablePackageJson,
  overrides: Overrides
) => void

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

const PNPM_FIELD_NAME = PNPM

const depFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
  'bundleDependencies'
]

function getEntryIndexes(
  entries: [string | symbol, any][],
  keys: (string | symbol)[]
): number[] {
  return keys
    .map(n => entries.findIndex(p => p[0] === n))
    .filter(n => n !== -1)
    .sort((a, b) => a - b)
}

function getLowestEntryIndex(
  entries: [string | symbol, any][],
  keys: (string | symbol)[]
) {
  return getEntryIndexes(entries, keys)?.[0] ?? -1
}

function getHighestEntryIndex(
  entries: [string | symbol, any][],
  keys: (string | symbol)[]
) {
  return getEntryIndexes(entries, keys).at(-1) ?? -1
}

function updatePkgJson(
  editablePkgJson: EditablePackageJson,
  field: string,
  value: any
) {
  const pkgJson = editablePkgJson.content
  const oldValue = pkgJson[field]
  if (oldValue) {
    // The field already exists so we simply update the field value.
    if (field === PNPM_FIELD_NAME) {
      if (hasKeys(value)) {
        editablePkgJson.update({
          [field]: {
            ...(isObject(oldValue) ? oldValue : {}),
            overrides: value
          }
        })
      } else {
        // Properties with undefined values are omitted when saved as JSON.
        editablePkgJson.update(<typeof pkgJson>(hasKeys(pkgJson[field])
            ? {
                [field]: {
                  ...(isObject(oldValue) ? oldValue : {}),
                  overrides: undefined
                }
              }
            : { [field]: undefined }))
      }
    } else if (field === OVERRIDES || field === RESOLUTIONS) {
      // Properties with undefined values are omitted when saved as JSON.
      editablePkgJson.update(<typeof pkgJson>{
        [field]: hasKeys(value) ? value : undefined
      })
    } else {
      editablePkgJson.update({ [field]: value })
    }
    return
  }
  if (
    (field === OVERRIDES ||
      field === PNPM_FIELD_NAME ||
      field === RESOLUTIONS) &&
    !hasKeys(value)
  ) {
    return
  }
  // Since the field doesn't exist we want to insert it into the package.json
  // in a place that makes sense, e.g. close to the "dependencies" field. If
  // we can't find a place to insert the field we'll add it to the bottom.
  const entries = Object.entries(pkgJson)
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
  } else if (field === PNPM_FIELD_NAME) {
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
  entries.splice(insertIndex, 0, [field, value])
  editablePkgJson.fromJSON(
    `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`
  )
}

function updateOverrides(
  editablePkgJson: EditablePackageJson,
  overrides: Overrides
) {
  updatePkgJson(editablePkgJson, OVERRIDES, overrides)
}

function updateResolutions(
  editablePkgJson: EditablePackageJson,
  overrides: Overrides
) {
  updatePkgJson(editablePkgJson, RESOLUTIONS, <PnpmOrYarnOverrides>overrides)
}

function pnpmUpdatePkgJson(
  editablePkgJson: EditablePackageJson,
  overrides: Overrides
) {
  updatePkgJson(editablePkgJson, PNPM_FIELD_NAME, overrides)
}

export const updateManifestByAgent = new Map<Agent, AgentModifyManifestFn>([
  [BUN, updateResolutions],
  [NPM, updateOverrides],
  [PNPM, pnpmUpdatePkgJson],
  [VLT, updateOverrides],
  [YARN_BERRY, updateResolutions],
  [YARN_CLASSIC, updateResolutions]
])
