import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugLog } from '@socketsecurity/registry/lib/debug'
import { hasOwn } from '@socketsecurity/registry/lib/objects'
import { fetchPackagePackument } from '@socketsecurity/registry/lib/packages'

import constants from '../../constants'
import { SafeArborist } from '../../shadow/npm/arborist/lib/arborist'
import { DiffAction } from '../../shadow/npm/arborist/lib/arborist/types'
import { Edge } from '../../shadow/npm/arborist/lib/edge'
import { getPublicToken, setupSdk } from '../../utils/sdk'
import { CompactSocketArtifact } from '../alert/artifact'
import { addArtifactToAlertsMap } from '../socket-package-alert'

import type { Diff } from '../../shadow/npm/arborist/lib/arborist/types'
import type { SafeEdge } from '../../shadow/npm/arborist/lib/edge'
import type { SafeNode } from '../../shadow/npm/arborist/lib/node'
import type { AlertsByPkgId } from '../socket-package-alert'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

type Packument = Exclude<
  Awaited<ReturnType<typeof fetchPackagePackument>>,
  null
>

const { LOOP_SENTINEL, NPM, NPM_REGISTRY_URL } = constants

type DiffQueryIncludeFilter = {
  unchanged?: boolean | undefined
  unknownOrigin?: boolean | undefined
}

type DiffQueryOptions = {
  include?: DiffQueryIncludeFilter | undefined
}

type PackageDetail = {
  node: SafeNode
  existing?: SafeNode | undefined
}

function getDetailsFromDiff(
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
          debugLog('SKIPPING META CHANGE ON', diff)
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

function getUrlOrigin(input: string): string {
  try {
    return URL.parse(input)?.origin ?? ''
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

export function findPackageNodes(
  tree: SafeNode,
  packageName: string
): SafeNode[] {
  const queue: Array<{ node: typeof tree }> = [{ node: tree }]
  const matches: SafeNode[] = []
  let sentinel = 0
  while (queue.length) {
    if (sentinel++ === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in findPackageNodes')
    }
    const { node: currentNode } = queue.pop()!
    const node = currentNode.children.get(packageName)
    if (node) {
      matches.push(node as unknown as SafeNode)
    }
    const children = [...currentNode.children.values()]
    for (let i = children.length - 1; i >= 0; i -= 1) {
      queue.push({ node: children[i] as unknown as SafeNode })
    }
  }
  return matches
}

type AlertIncludeFilter = {
  critical?: boolean | undefined
  cve?: boolean | undefined
  existing?: boolean | undefined
  unfixable?: boolean | undefined
  upgrade?: boolean | undefined
}

type GetAlertsMapFromArboristOptions = {
  consolidate?: boolean | undefined
  include?: AlertIncludeFilter | undefined
  spinner?: Spinner | undefined
}

export async function getAlertsMapFromArborist(
  arb: SafeArborist,
  options?: GetAlertsMapFromArboristOptions | undefined
): Promise<AlertsByPkgId> {
  const { include: _include, spinner } = {
    __proto__: null,
    consolidate: false,
    ...options
  } as GetAlertsMapFromArboristOptions

  const include = {
    __proto__: null,
    critical: true,
    cve: true,
    existing: false,
    unfixable: true,
    upgrade: false,
    ..._include
  } as AlertIncludeFilter

  const needInfoOn = getDetailsFromDiff(arb.diff, {
    include: {
      unchanged: include.existing
    }
  })
  const pkgIds = arrayUnique(needInfoOn.map(d => d.node.pkgid))
  let { length: remaining } = pkgIds
  const alertsByPkgId: AlertsByPkgId = new Map()
  if (!remaining) {
    return alertsByPkgId
  }

  const getText = () => `Looking up data for ${remaining} packages`

  spinner?.start(getText())

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
      })
    )
  }

  const socketSdk = await setupSdk(getPublicToken())

  const toAlertsMapOptions = {
    overrides,
    ...options
  }

  for await (const batchPackageFetchResult of socketSdk.batchPackageStream(
    {
      alerts: 'true',
      compact: 'true',
      fixable: include.unfixable ? 'false' : 'true'
    },
    {
      components: pkgIds.map(id => ({ purl: `pkg:npm/${id}` }))
    }
  )) {
    if (batchPackageFetchResult.success) {
      await addArtifactToAlertsMap(
        batchPackageFetchResult.data as CompactSocketArtifact,
        alertsByPkgId,
        toAlertsMapOptions
      )
    }
    remaining -= 1
    if (spinner && remaining > 0) {
      spinner.start()
      spinner.setText(getText())
    }
  }

  spinner?.stop()

  return alertsByPkgId
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
  // Use Object.defineProperty to override the version.
  Object.defineProperty(node, 'version', {
    configurable: true,
    enumerable: true,
    get: () => targetVersion
  })
  node.package.version = targetVersion
  // Update resolved and clear integrity for the new version.
  const purlObj = PackageURL.fromString(`pkg:npm/${node.name}`)
  node.resolved = `${NPM_REGISTRY_URL}/${node.name}/-/${purlObj.name}-${targetVersion}.tgz`
  const { integrity } = targetPackument.dist
  if (integrity) {
    node.integrity = integrity
  } else {
    delete node.integrity
  }
  if ('deprecated' in targetPackument) {
    node.package['deprecated'] = targetPackument.deprecated as string
  } else {
    delete node.package['deprecated']
  }
  const newDeps = { ...targetPackument.dependencies }
  const { dependencies: oldDeps } = node.package
  node.package.dependencies = newDeps
  if (oldDeps) {
    for (const oldDepName of Object.keys(oldDeps)) {
      if (!hasOwn(newDeps, oldDepName)) {
        node.edgesOut.get(oldDepName)?.detach()
      }
    }
  }
  for (const newDepName of Object.keys(newDeps)) {
    if (!hasOwn(oldDeps, newDepName)) {
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
