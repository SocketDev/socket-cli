import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { getManifestData } from '@socketsecurity/registry'
import { debugFn } from '@socketsecurity/registry/lib/debug'
import { hasOwn } from '@socketsecurity/registry/lib/objects'
import { fetchPackagePackument } from '@socketsecurity/registry/lib/packages'

import constants from '../../constants.mts'
import { Edge } from './arborist/index.mts'
import { DiffAction } from './arborist/types.mts'
import { getAlertsMapFromPurls } from '../../utils/alerts-map.mts'
import { type AliasResult, npa } from '../../utils/npm-package-arg.mts'
import { applyRange, getMajor, getMinVersion } from '../../utils/semver.mts'
import { idToNpmPurl } from '../../utils/spec.mts'

import type {
  ArboristInstance,
  Diff,
  EdgeClass,
  LinkClass,
  NodeClass,
} from './arborist/types.mts'
import type { RangeStyle } from '../../utils/semver.mts'
import type {
  AlertIncludeFilter,
  AlertsByPurl,
} from '../../utils/socket-package-alert.mts'
import type { EditablePackageJson } from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { LOOP_SENTINEL, NPM, NPM_REGISTRY_URL } = constants

function getUrlOrigin(input: string): string {
  try {
    // TODO: URL.parse is available in Node 22.1.0. We can use it when we drop Node 18.
    // https://nodejs.org/docs/latest-v22.x/api/url.html#urlparseinput-base
    // return URL.parse(input)?.origin ?? ''
    return new URL(input).origin ?? ''
  } catch {}
  return ''
}

export type BestPatchVersionOptions = {
  minSatisfying?: boolean | undefined
  vulnerableVersionRange?: string | undefined
}

export function findBestPatchVersion(
  node: NodeClass,
  availableVersions: string[],
  options?: BestPatchVersionOptions | undefined,
): string | null {
  const { minSatisfying = false, vulnerableVersionRange } = {
    __proto__: null,
    ...options,
  } as BestPatchVersionOptions
  const manifestData = getManifestData(NPM, node.name)
  let eligibleVersions
  if (manifestData && manifestData.name === manifestData.package) {
    const major = getMajor(manifestData.version)
    if (typeof major !== 'number') {
      return null
    }
    eligibleVersions = availableVersions.filter(v => getMajor(v) === major)
  } else {
    const major = getMajor(node.version)
    if (typeof major !== 'number') {
      return null
    }
    eligibleVersions = availableVersions.filter(
      v =>
        // Filter for versions that are within the current major version and
        // are NOT in the vulnerable range.
        getMajor(v) === major &&
        (!vulnerableVersionRange ||
          !semver.satisfies(v, vulnerableVersionRange)),
    )
  }
  if (eligibleVersions) {
    const satisfying = minSatisfying
      ? semver.minSatisfying
      : semver.maxSatisfying
    return satisfying(eligibleVersions, '*')
  }
  return null
}

export function findPackageNode(
  tree: NodeClass,
  name: string,
  version?: string | undefined,
): NodeClass | undefined {
  const queue: Array<NodeClass | LinkClass> = [tree]
  const visited = new Set<NodeClass>()
  let sentinel = 0
  while (queue.length) {
    if (sentinel++ === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in findPackageNode')
    }
    const nodeOrLink = queue.pop()!
    const node = getTargetNode(nodeOrLink)
    if (visited.has(node)) {
      continue
    }
    visited.add(node)
    if (
      node.name === name &&
      (typeof version !== 'string' || node.version === version)
    ) {
      return node
    }
    for (const child of node.children.values()) {
      queue.push(child)
    }
    for (const edge of node.edgesOut.values()) {
      const { to } = edge
      if (to) {
        queue.push(to)
      }
    }
  }
  return undefined
}

export function findPackageNodes(
  tree: NodeClass,
  name: string,
  version?: string | undefined,
): NodeClass[] {
  const matches: NodeClass[] = []
  const queue: Array<NodeClass | LinkClass> = [tree]
  const visited = new Set<NodeClass>()
  let sentinel = 0
  while (queue.length) {
    if (sentinel++ === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in findPackageNodes')
    }
    const nodeOrLink = queue.pop()!
    const node = getTargetNode(nodeOrLink)
    if (visited.has(node)) {
      continue
    }
    visited.add(node)

    const { version: targetVersion } = node
    if (!targetVersion && Array.isArray(node.errors) && node.errors.length) {
      debugFn(`miss: version for ${node.name} due to errors:\n`, node.errors)
    }
    if (
      node.name === name &&
      (typeof version !== 'string' || node.version === version)
    ) {
      matches.push(node)
    }
    for (const child of node.children.values()) {
      queue.push(child)
    }
    for (const edge of node.edgesOut.values()) {
      const { to } = edge
      if (to) {
        queue.push(to)
      }
    }
  }
  return matches
}

export type GetAlertsMapFromArboristOptions = {
  consolidate?: boolean | undefined
  include?: AlertIncludeFilter | undefined
  nothrow?: boolean | undefined
  spinner?: Spinner | undefined
}

export async function getAlertsMapFromArborist(
  arb: ArboristInstance,
  options_?: GetAlertsMapFromArboristOptions | undefined,
): Promise<AlertsByPurl> {
  const options = {
    __proto__: null,
    consolidate: false,
    include: undefined,
    limit: Infinity,
    nothrow: false,
    ...options_,
  } as GetAlertsMapFromArboristOptions

  options.include = {
    __proto__: null,
    // Leave 'actions' unassigned so it can be given a default value in
    // subsequent functions where `options` is passed.
    // actions: undefined,
    blocked: true,
    critical: true,
    cve: true,
    existing: false,
    unfixable: true,
    upgradable: false,
    ...options.include,
  } as AlertIncludeFilter

  const needInfoOn = getDetailsFromDiff(arb.diff, {
    include: {
      unchanged: options.include.existing,
    },
  })

  const purls = needInfoOn.map(d => idToNpmPurl(d.node.pkgid))

  let overrides: { [key: string]: string } | undefined
  const overridesMap = (
    arb.actualTree ??
    arb.idealTree ??
    (await arb.loadActual())
  )?.overrides?.children
  if (overridesMap) {
    overrides = Object.fromEntries(
      Array.from(overridesMap.entries()).map(([key, overrideSet]) => {
        return [key, overrideSet.value!]
      }),
    )
  }

  return await getAlertsMapFromPurls(purls, {
    overrides,
    ...options,
  })
}

export type DiffQueryIncludeFilter = {
  unchanged?: boolean | undefined
  unknownOrigin?: boolean | undefined
}

export type DiffQueryOptions = {
  include?: DiffQueryIncludeFilter | undefined
}

export type PackageDetail = {
  node: NodeClass
  existing?: NodeClass | undefined
}

export function getDetailsFromDiff(
  diff: Diff | null,
  options?: DiffQueryOptions | undefined,
): PackageDetail[] {
  const details: PackageDetail[] = []
  // `diff` is `null` when `npm install --package-lock-only` is passed.
  if (!diff) {
    debugFn(`miss: diff is ${diff}`)
    return details
  }

  const include = {
    __proto__: null,
    unchanged: false,
    unknownOrigin: true,
    ...({ __proto__: null, ...options } as DiffQueryOptions).include,
  } as DiffQueryIncludeFilter

  const queue: Diff[] = [...diff.children]
  let pos = 0
  let { length: queueLength } = queue
  while (pos < queueLength) {
    if (pos === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop while walking Arborist diff')
    }
    const currDiff = queue[pos++]!
    const { action } = currDiff
    if (action) {
      // The `pkgNode`, i.e. the `ideal` node, will be `undefined` if the diff
      // action is 'REMOVE'
      // The `oldNode`, i.e. the `actual` node, will be `undefined` if the diff
      // action is 'ADD'.
      const { actual: oldNode, ideal: pkgNode } = currDiff
      let existing: NodeClass | undefined
      let keep = false
      if (action === DiffAction.change) {
        if (pkgNode?.package.version !== oldNode?.package.version) {
          keep = true
          if (
            oldNode?.package.name &&
            oldNode.package.name === pkgNode?.package.name
          ) {
            existing = oldNode
          }
        } else {
          // TODO: This debug log has too much information. We should narrow it down.
          // debugFn('skip: meta change diff\n', diff)
        }
      } else {
        keep = action !== DiffAction.remove
      }
      if (keep && pkgNode?.resolved && (!oldNode || oldNode.resolved)) {
        if (
          include.unknownOrigin ||
          getUrlOrigin(pkgNode.resolved) === NPM_REGISTRY_URL
        ) {
          details.push({
            node: pkgNode,
            existing,
          })
        }
      }
    }
    for (const child of currDiff.children) {
      queue[queueLength++] = child
    }
  }
  if (include.unchanged) {
    const { unchanged } = diff
    for (let i = 0, { length } = unchanged; i < length; i += 1) {
      const pkgNode = unchanged[i]!
      if (
        include.unknownOrigin ||
        getUrlOrigin(pkgNode.resolved!) === NPM_REGISTRY_URL
      ) {
        details.push({
          node: pkgNode,
          existing: pkgNode,
        })
      }
    }
  }
  return details
}

export function getTargetNode(nodeOrLink: NodeClass | LinkClass): NodeClass
export function getTargetNode<T>(nodeOrLink: T): NodeClass | null
export function getTargetNode(nodeOrLink: any): NodeClass | null {
  return nodeOrLink?.isLink ? nodeOrLink.target : (nodeOrLink ?? null)
}

export function isTopLevel(tree: NodeClass, node: NodeClass): boolean {
  return getTargetNode(tree.children.get(node.name)) === node
}

export type Packument = Exclude<
  Awaited<ReturnType<typeof fetchPackagePackument>>,
  null
>

export function updatePackageJsonFromNode(
  editablePkgJson: EditablePackageJson,
  tree: NodeClass,
  node: NodeClass,
  newVersion: string,
  rangeStyle?: RangeStyle | undefined,
): boolean {
  let result = false
  if (!isTopLevel(tree, node)) {
    return result
  }
  const { name } = node
  for (const depField of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const depObject = editablePkgJson.content[depField] as
      | { [key: string]: string }
      | undefined
    const depValue = hasOwn(depObject, name) ? depObject[name] : undefined
    if (typeof depValue !== 'string' || depValue.startsWith('catalog:')) {
      continue
    }
    let oldRange = depValue
    // Use npa if depValue looks like more than just a semver range.
    if (depValue.includes(':')) {
      const npaResult = npa(depValue)
      if (!npaResult || (npaResult as AliasResult).subSpec) {
        continue
      }
      oldRange = npaResult.rawSpec
    }
    const oldMin = getMinVersion(oldRange)
    const newRange =
      oldMin &&
      // Ensure we're on the same major version...
      getMajor(newVersion) === oldMin.major &&
      // and not a downgrade.
      semver.gte(newVersion, oldMin.version)
        ? applyRange(oldRange, newVersion, rangeStyle)
        : oldRange
    if (oldRange !== newRange) {
      result = true
      editablePkgJson.update({
        [depField]: {
          ...depObject,
          [name]: newRange,
        },
      })
    }
  }
  return result
}
