import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { getManifestData } from '@socketsecurity/registry'
import { debugFn } from '@socketsecurity/registry/lib/debug'
import { getOwn, hasOwn } from '@socketsecurity/registry/lib/objects'
import { fetchPackagePackument } from '@socketsecurity/registry/lib/packages'

import constants, { NPM } from '../../constants.mts'
import { Edge } from './arborist/index.mts'
import { DiffAction } from './arborist/types.mts'
import { getAlertsMapFromPurls } from '../../utils/alerts-map.mts'
import { toFilterConfig } from '../../utils/filter-config.mts'
import { npa } from '../../utils/npm-package-arg.mts'
import { applyRange, getMajor, getMinVersion } from '../../utils/semver.mts'
import { idToNpmPurl } from '../../utils/spec.mts'

import type {
  ArboristInstance,
  Diff,
  EdgeClass,
  LinkClass,
  NodeClass,
} from './arborist/types.mts'
import type { AliasResult } from '../../utils/npm-package-arg.mts'
import type { RangeStyle } from '../../utils/semver.mts'
import type {
  AlertFilter,
  AlertsByPurl,
} from '../../utils/socket-package-alert.mts'
import type { EditablePackageJson } from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

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
    if (sentinel++ === constants.LOOP_SENTINEL) {
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
    if (sentinel++ === constants.LOOP_SENTINEL) {
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
      debugFn(
        'notice',
        `miss: version for ${node.name} due to errors:\n`,
        node.errors,
      )
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
  apiToken?: string | undefined
  consolidate?: boolean | undefined
  filter?: AlertFilter | undefined
  nothrow?: boolean | undefined
  spinner?: Spinner | undefined
}

export async function getAlertsMapFromArborist(
  arb: ArboristInstance,
  needInfoOn: PackageDetail[],
  options?: GetAlertsMapFromArboristOptions | undefined,
): Promise<AlertsByPurl> {
  const opts = {
    __proto__: null,
    consolidate: false,
    nothrow: false,
    ...options,
    filter: toFilterConfig(getOwn(options, 'filter')),
  } as GetAlertsMapFromArboristOptions & { filter: AlertFilter }

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
    ...opts,
  })
}

export type DiffQueryFilter = {
  existing?: boolean | undefined
  unknownOrigin?: boolean | undefined
}

export type DiffQueryOptions = {
  filter?: DiffQueryFilter | undefined
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
    debugFn('notice', `miss: diff is ${diff}`)
    return details
  }

  const { NPM_REGISTRY_URL } = constants

  const filterConfig = toFilterConfig({
    existing: false,
    unknownOrigin: true,
    ...getOwn(options, 'filter'),
  }) as DiffQueryFilter

  const queue: Diff[] = [...diff.children]
  let pos = 0
  let { length: queueLength } = queue
  while (pos < queueLength) {
    if (pos === constants.LOOP_SENTINEL) {
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
        }
      } else {
        keep = action !== DiffAction.remove
      }
      if (keep && pkgNode?.resolved && (!oldNode || oldNode.resolved)) {
        if (
          filterConfig.unknownOrigin ||
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
  if (filterConfig.existing) {
    const { unchanged } = diff
    for (let i = 0, { length } = unchanged; i < length; i += 1) {
      const pkgNode = unchanged[i]!
      if (
        filterConfig.unknownOrigin ||
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

export function updateNode(
  node: NodeClass,
  newVersion: string,
  newVersionPackument: Packument['versions'][number],
): void {
  // Object.defineProperty is needed to set the version property and replace
  // the old value with newVersion.
  Object.defineProperty(node, 'version', {
    configurable: true,
    enumerable: true,
    get: () => newVersion,
  })
  // Update package.version associated with the node.
  node.package.version = newVersion
  // Update node.resolved.
  const purlObj = PackageURL.fromString(idToNpmPurl(node.name))
  node.resolved = `${constants.NPM_REGISTRY_URL}/${node.name}/-/${purlObj.name}-${newVersion}.tgz`
  // Update node.integrity with the targetPackument.dist.integrity value if available
  // else delete node.integrity so a new value is resolved for the target version.
  const { integrity } = newVersionPackument.dist
  if (integrity) {
    node.integrity = integrity
  } else {
    delete node.integrity
  }
  // Update node.package.deprecated based on targetPackument.deprecated.
  if (hasOwn(newVersionPackument, 'deprecated')) {
    node.package['deprecated'] = newVersionPackument.deprecated as string
  } else {
    delete node.package['deprecated']
  }
  // Update node.package.dependencies.
  const newDeps = { ...newVersionPackument.dependencies }
  const { dependencies: oldDeps } = node.package
  node.package.dependencies = newDeps
  if (oldDeps) {
    for (const oldDepName of Object.keys(oldDeps)) {
      if (!hasOwn(newDeps, oldDepName)) {
        // Detach old edges for dependencies that don't exist on the updated
        // node.package.dependencies.
        node.edgesOut.get(oldDepName)?.detach()
      }
    }
  }
  for (const newDepName of Object.keys(newDeps)) {
    if (!hasOwn(oldDeps, newDepName)) {
      // Add new edges for dependencies that don't exist on the old
      // node.package.dependencies.
      node.addEdgeOut(
        new Edge({
          from: node,
          name: newDepName,
          spec: newDeps[newDepName],
          type: 'prod',
        }) as unknown as EdgeClass,
      )
    }
  }
}

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
