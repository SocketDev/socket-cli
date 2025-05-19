import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { getManifestData } from '@socketsecurity/registry'
import { hasOwn } from '@socketsecurity/registry/lib/objects'
import { fetchPackagePackument } from '@socketsecurity/registry/lib/packages'

import constants from '../../constants.mts'
import { applyRange, getMajor } from '../../utils/semver.mts'
import { idToPurl } from '../../utils/spec.mts'
import { DiffAction } from './arborist/lib/arborist/types.mts'
import { Edge } from './arborist/lib/edge.mts'
import { getAlertsMapFromPurls } from '../../utils/alerts-map.mts'

import type { RangeStyle } from '../../utils/semver.mts'
import type { SafeArborist } from './arborist/lib/arborist/index.mts'
import type { Diff } from './arborist/lib/arborist/types.mts'
import type { SafeEdge } from './arborist/lib/edge.mts'
import type { LinkClass, SafeNode } from './arborist/lib/node.mts'
import type {
  AlertIncludeFilter,
  AlertsByPkgId,
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

export function findBestPatchVersion(
  node: SafeNode,
  availableVersions: string[],
  vulnerableVersionRange?: string,
  _firstPatchedVersionIdentifier?: string | undefined,
): string | null {
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
  return eligibleVersions ? semver.maxSatisfying(eligibleVersions, '*') : null
}

export function findPackageNode(
  tree: SafeNode,
  name: string,
  version?: string | undefined,
): SafeNode | undefined {
  const queue: Array<SafeNode | LinkClass> = [tree]
  const visited = new Set<SafeNode>()
  let sentinel = 0
  while (queue.length) {
    if (sentinel++ === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in findPackageNode')
    }
    const nodeOrLink = queue.pop()!
    const node = nodeOrLink.isLink ? nodeOrLink.target : nodeOrLink
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
  tree: SafeNode,
  name: string,
  version?: string | undefined,
): SafeNode[] {
  const matches: SafeNode[] = []
  const queue: Array<SafeNode | LinkClass> = [tree]
  const visited = new Set<SafeNode>()
  let sentinel = 0
  while (queue.length) {
    if (sentinel++ === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in findPackageNodes')
    }
    const nodeOrLink = queue.pop()!
    const node = nodeOrLink.isLink ? nodeOrLink.target : nodeOrLink
    if (visited.has(node)) {
      continue
    }
    visited.add(node)
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
  arb: SafeArborist,
  options_?: GetAlertsMapFromArboristOptions | undefined,
): Promise<AlertsByPkgId> {
  const options = {
    __proto__: null,
    consolidate: false,
    limit: Infinity,
    nothrow: false,
    ...options_,
  } as GetAlertsMapFromArboristOptions

  const include = {
    __proto__: null,
    actions: undefined,
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
      unchanged: include.existing,
    },
  })

  const purls = needInfoOn.map(d => idToPurl(d.node.pkgid))

  let overrides: { [key: string]: string } | undefined
  const overridesMap = (
    arb.actualTree ??
    arb.idealTree ??
    (await arb.loadActual())
  )?.overrides?.children
  if (overridesMap) {
    overrides = Object.fromEntries(
      [...overridesMap.entries()].map(([key, overrideSet]) => {
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
  node: SafeNode
  existing?: SafeNode | undefined
}

export function getDetailsFromDiff(
  diff_: Diff | null,
  options?: DiffQueryOptions | undefined,
): PackageDetail[] {
  const details: PackageDetail[] = []
  // `diff_` is `null` when `npm install --package-lock-only` is passed.
  if (!diff_) {
    return details
  }

  const include = {
    __proto__: null,
    unchanged: false,
    unknownOrigin: false,
    ...({ __proto__: null, ...options } as DiffQueryOptions).include,
  } as DiffQueryIncludeFilter

  const queue: Diff[] = [...diff_.children]
  let pos = 0
  let { length: queueLength } = queue
  while (pos < queueLength) {
    if (pos === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop while walking Arborist diff')
    }
    const diff = queue[pos++]!
    const { action } = diff
    if (action) {
      // The `pkgNode`, i.e. the `ideal` node, will be `undefined` if the diff
      // action is 'REMOVE'
      // The `oldNode`, i.e. the `actual` node, will be `undefined` if the diff
      // action is 'ADD'.
      const { actual: oldNode, ideal: pkgNode } = diff
      let existing: SafeNode | undefined
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
          // debugLog('SKIPPING META CHANGE ON', diff)
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
    for (const child of diff.children) {
      queue[queueLength++] = child
    }
  }
  if (include.unchanged) {
    const { unchanged } = diff_!
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

export function isTopLevel(tree: SafeNode, node: SafeNode): boolean {
  const childNodeOrLink = tree.children.get(node.name)
  const childNode = childNodeOrLink?.isLink
    ? childNodeOrLink.target
    : childNodeOrLink
  return childNode === node
}

export type Packument = Exclude<
  Awaited<ReturnType<typeof fetchPackagePackument>>,
  null
>

export function updateNode(
  node: SafeNode,
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
  const purlObj = PackageURL.fromString(idToPurl(node.name))
  node.resolved = `${NPM_REGISTRY_URL}/${node.name}/-/${purlObj.name}-${newVersion}.tgz`
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
        }) as unknown as SafeEdge,
      )
    }
  }
}

export function updatePackageJsonFromNode(
  editablePkgJson: EditablePackageJson,
  tree: SafeNode,
  node: SafeNode,
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
    if (depObject) {
      const oldRange = depObject[name]
      if (oldRange) {
        const newRange = applyRange(oldRange, newVersion, rangeStyle)
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
    }
  }
  return result
}
