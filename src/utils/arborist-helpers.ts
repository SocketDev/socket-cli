import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { getManifestData } from '@socketsecurity/registry'
import { debugLog } from '@socketsecurity/registry/lib/debug'
import { hasOwn } from '@socketsecurity/registry/lib/objects'
import {
  EditablePackageJson,
  fetchPackagePackument
} from '@socketsecurity/registry/lib/packages'

import constants from '../constants'
import { applyRange } from './semver'
import { DiffAction } from '../shadow/npm/arborist/lib/arborist/types'
import { Edge } from '../shadow/npm/arborist/lib/edge'

import type { RangeStyle } from './semver'
import type { Diff } from '../shadow/npm/arborist/lib/arborist/types'
import type { SafeEdge } from '../shadow/npm/arborist/lib/edge'
import type { SafeNode } from '../shadow/npm/arborist/lib/node'

export type Packument = Exclude<
  Awaited<ReturnType<typeof fetchPackagePackument>>,
  null
>

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
  _firstPatchedVersionIdentifier?: string | undefined
): string | null {
  const manifestData = getManifestData(NPM, node.name)
  let eligibleVersions
  if (manifestData && manifestData.name === manifestData.package) {
    const major = semver.major(manifestData.version)
    eligibleVersions = availableVersions.filter(v => semver.major(v) === major)
  } else {
    const major = semver.major(node.version)
    eligibleVersions = availableVersions.filter(
      v =>
        // Filter for versions that are within the current major version and
        // are NOT in the vulnerable range.
        semver.major(v) === major &&
        (!vulnerableVersionRange ||
          !semver.satisfies(v, vulnerableVersionRange))
    )
  }
  return semver.maxSatisfying(eligibleVersions, '*')
}

export function findPackageNode(
  tree: SafeNode,
  name: string,
  version?: string | undefined
): SafeNode | undefined {
  const queue: SafeNode[] = [tree]
  let sentinel = 0
  while (queue.length) {
    if (sentinel++ === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in findPackageNodes')
    }
    const currentNode = queue.pop()!
    const node = currentNode.children.get(name)
    if (node && (typeof version !== 'string' || node.version === version)) {
      return node as unknown as SafeNode
    }
    const children = [...currentNode.children.values()]
    for (let i = children.length - 1; i >= 0; i -= 1) {
      queue.push(children[i] as unknown as SafeNode)
    }
  }
}

export function findPackageNodes(
  tree: SafeNode,
  name: string,
  version?: string | undefined
): SafeNode[] {
  const queue: SafeNode[] = [tree]
  const matches: SafeNode[] = []
  let sentinel = 0
  while (queue.length) {
    if (sentinel++ === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in findPackageNodes')
    }
    const currentNode = queue.pop()!
    const node = currentNode.children.get(name)
    if (node && (typeof version !== 'string' || node.version === version)) {
      matches.push(node as unknown as SafeNode)
    }
    const children = [...currentNode.children.values()]
    for (let i = children.length - 1; i >= 0; i -= 1) {
      queue.push(children[i] as unknown as SafeNode)
    }
  }
  return matches
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
  options?: DiffQueryOptions | undefined
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
    ...({ __proto__: null, ...options } as DiffQueryOptions).include
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
          debugLog('SKIPPING META CHANGE ON\n', diff)
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
            existing
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
          existing: pkgNode
        })
      }
    }
  }
  return details
}

export function isTopLevel(tree: SafeNode, node: SafeNode): boolean {
  return tree.children.get(node.name) === node
}

export function updateNode(
  node: SafeNode,
  packument: Packument,
  vulnerableVersionRange?: string,
  firstPatchedVersionIdentifier?: string | undefined
): boolean {
  const availableVersions = Object.keys(packument.versions)
  // Find the highest non-vulnerable version within the same major range
  const targetVersion = findBestPatchVersion(
    node,
    availableVersions,
    vulnerableVersionRange,
    firstPatchedVersionIdentifier
  )
  const targetPackument = targetVersion
    ? packument.versions[targetVersion]
    : undefined
  // Check !targetVersion to make TypeScript happy.
  if (!targetVersion || !targetPackument) {
    // No suitable patch version found.
    return false
  }
  // Object.defineProperty is needed to set the version property and replace
  // the old value with targetVersion.
  Object.defineProperty(node, 'version', {
    configurable: true,
    enumerable: true,
    get: () => targetVersion
  })
  // Update package.version associated with the node.
  node.package.version = targetVersion
  // Update node.resolved.
  const purlObj = PackageURL.fromString(`pkg:npm/${node.name}`)
  node.resolved = `${NPM_REGISTRY_URL}/${node.name}/-/${purlObj.name}-${targetVersion}.tgz`
  // Update node.integrity with the targetPackument.dist.integrity value if available
  // else delete node.integrity so a new value is resolved for the target version.
  const { integrity } = targetPackument.dist
  if (integrity) {
    node.integrity = integrity
  } else {
    delete node.integrity
  }
  // Update node.package.deprecated based on targetPackument.deprecated.
  if (hasOwn(targetPackument, 'deprecated')) {
    node.package['deprecated'] = targetPackument.deprecated as string
  } else {
    delete node.package['deprecated']
  }
  // Update node.package.dependencies.
  const newDeps = { ...targetPackument.dependencies }
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
          type: 'prod'
        }) as unknown as SafeEdge
      )
    }
  }
  return true
}

export function updatePackageJsonFromNode(
  editablePkgJson: EditablePackageJson,
  tree: SafeNode,
  node: SafeNode,
  targetVersion: string,
  rangeStyle?: RangeStyle | undefined
): boolean {
  let result = false
  if (isTopLevel(tree, node)) {
    const { name } = node
    for (const depField of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies'
    ]) {
      const depObject = editablePkgJson.content[depField] as
        | { [key: string]: string }
        | undefined
      if (depObject) {
        const oldRange = depObject[name]
        if (oldRange) {
          const newRange = applyRange(oldRange, targetVersion, rangeStyle)
          if (oldRange !== newRange) {
            result = true
            editablePkgJson.update({
              [depField]: {
                ...depObject,
                [name]: newRange
              }
            })
          }
        }
      }
    }
  }
  return result
}
