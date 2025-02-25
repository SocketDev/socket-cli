import path from 'node:path'
import process from 'node:process'

import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { hasOwn } from '@socketsecurity/registry/lib/objects'
import {
  fetchPackagePackument,
  resolvePackageName
} from '@socketsecurity/registry/lib/packages'
import { confirm } from '@socketsecurity/registry/lib/prompts'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { getPackagesToQueryFromDiff } from './diff'
import constants from '../../../../constants'
import {
  batchScan,
  isArtifactAlertCveFixable,
  isArtifactAlertUpgradeFixable
} from '../../../../utils/alert/artifact'
import { uxLookup } from '../../../../utils/alert/rules'
import { ColorOrMarkdown } from '../../../../utils/color-or-markdown'
import { getSocketDevPackageOverviewUrl } from '../../../../utils/socket-url'
import { Edge, SafeEdge } from '../edge'

import type { ArboristClass, ArboristReifyOptions } from './types'
import type { SocketArtifact } from '../../../../utils/alert/artifact'
import type { SafeNode } from '../node'
import type { Writable } from 'node:stream'

type PackageJsonType = SafeNode['package']

type Packument = Exclude<
  Awaited<ReturnType<typeof fetchPackagePackument>>,
  null
>

type SocketPackageAlert = {
  key: string
  type: string
  name: string
  version: string
  block: boolean
  fixable: boolean
  raw: any
}

const {
  CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER,
  LOOP_SENTINEL,
  NPM,
  NPM_REGISTRY_URL,
  OVERRIDES,
  PNPM,
  RESOLUTIONS,
  abortSignal
} = constants

const formatter = new ColorOrMarkdown(false)

function findBestPatchVersion(
  node: SafeNode,
  availableVersions: string[],
  vulnerableVersionRange?: string,
  _firstPatchedVersionIdentifier?: string
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
        // Filter for versions that are within the current major version
        // and are not in the vulnerable range
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
  const queue: { node: typeof tree }[] = [{ node: tree }]
  const matches: SafeNode[] = []
  let sentinel = 0
  while (queue.length) {
    if (sentinel++ === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in findPackageNodes')
    }
    const { node: currentNode } = queue.pop()!
    const node = currentNode.children.get(packageName)
    if (node) {
      matches.push((<unknown>node) as SafeNode)
    }
    const children = [...currentNode.children.values()]
    for (let i = children.length - 1; i >= 0; i -= 1) {
      queue.push({ node: (<unknown>children[i]) as SafeNode })
    }
  }
  return matches
}

let _translations: typeof import('../../../../../translations.json') | undefined
function getTranslations() {
  if (_translations === undefined) {
    _translations = require(
      // Lazily access constants.rootPath.
      path.join(constants.rootPath, 'translations.json')
    )
  }
  return _translations!
}

function hasOverride(pkgJson: PackageJsonType, name: string): boolean {
  return !!(
    (pkgJson as any)?.[OVERRIDES]?.[name] ||
    (pkgJson as any)?.[RESOLUTIONS]?.[name] ||
    (pkgJson as any)?.[PNPM]?.[OVERRIDES]?.[name]
  )
}

export function updateNode(
  node: SafeNode,
  packument: Packument,
  vulnerableVersionRange?: string,
  firstPatchedVersionIdentifier?: string
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
    node.package['deprecated'] = <string>targetPackument.deprecated
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
      node.addEdgeOut((<unknown>new Edge({
          from: node,
          name: newDepName,
          spec: newDeps[newDepName],
          type: 'prod'
        })) as SafeEdge)
    }
  }
  return true
}

type GetPackageAlertsOptions = {
  output?: Writable
  consolidate?: boolean
  includeExisting?: boolean
  includeUnfixable?: boolean
}

export async function getPackagesAlerts(
  arb: SafeArborist,
  options?: GetPackageAlertsOptions
): Promise<SocketPackageAlert[]> {
  const {
    consolidate = false,
    includeExisting = false,
    includeUnfixable = true,
    output
  } = <GetPackageAlertsOptions>{
    __proto__: null,
    ...options
  }
  const needInfoOn = getPackagesToQueryFromDiff(arb.diff, {
    includeUnchanged: includeExisting
  })
  const purls = arrayUnique(needInfoOn.map(d => d.node.pkgid))
  let { length: remaining } = purls
  const results: SocketPackageAlert[] = []
  if (!remaining) {
    return results
  }
  const pkgJson = (arb.actualTree ?? arb.idealTree)!.package
  const spinner = output ? new Spinner({ stream: output }) : undefined
  const getText = () => `Looking up data for ${remaining} packages`
  const decrementRemaining = () => {
    remaining -= 1
    if (spinner && remaining > 0) {
      spinner.start()
      spinner.text = getText()
    }
  }
  spinner?.start(getText())
  for await (const artifact of batchScan(purls)) {
    if (!artifact.name || !artifact.version || !artifact.alerts?.length) {
      decrementRemaining()
      continue
    }
    const name = resolvePackageName(artifact)
    const { version } = artifact
    let displayWarning = false
    let sockPkgAlerts = []
    for (const alert of artifact.alerts) {
      // eslint-disable-next-line no-await-in-loop
      const ux = await uxLookup({
        package: { name, version },
        alert: { type: alert.type }
      })
      if (ux.display) {
        displayWarning = !!output
      }
      const fixableCve = isArtifactAlertCveFixable(alert)
      const fixableUpgrade = isArtifactAlertUpgradeFixable(alert)
      if (
        (fixableCve || fixableUpgrade || includeUnfixable) &&
        !(fixableUpgrade && hasOverride(pkgJson, name))
      ) {
        sockPkgAlerts.push({
          name,
          version,
          key: alert.key,
          type: alert.type,
          block: ux.block,
          raw: alert,
          fixable: fixableCve || fixableUpgrade
        })
      }
    }
    if (!includeExisting && sockPkgAlerts.length) {
      // Before we ask about problematic issues, check to see if they
      // already existed in the old version if they did, be quiet.
      const allExisting = needInfoOn.filter(d =>
        d.existing?.pkgid.startsWith(`${name}@`)
      )
      for (const { existing } of allExisting) {
        const oldAlerts: SocketArtifact['alerts'] | undefined =
          // eslint-disable-next-line no-await-in-loop
          (await batchScan([existing!.pkgid]).next()).value?.alerts
        if (oldAlerts?.length) {
          // SocketArtifactAlert and SocketPackageAlert both have the 'key' property.
          sockPkgAlerts = sockPkgAlerts.filter(
            ({ key }) => !oldAlerts.find(a => a.key === key)
          )
        }
      }
    }
    if (consolidate && sockPkgAlerts.length) {
      const highestForCve = new Map<number, SocketPackageAlert>()
      const highestForUpgrade = new Map<number, SocketPackageAlert>()
      const unfixableAlerts: SocketPackageAlert[] = []
      for (const sockPkgAlert of sockPkgAlerts) {
        if (isArtifactAlertCveFixable(sockPkgAlert.raw)) {
          const version =
            sockPkgAlert.raw.props[
              CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER
            ]
          const major = semver.major(version)
          const highest =
            highestForCve.get(major)?.raw[
              CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER
            ] ?? '0.0.0'
          if (semver.gt(version, highest)) {
            highestForCve.set(major, sockPkgAlert)
          }
        } else if (isArtifactAlertUpgradeFixable(sockPkgAlert.raw)) {
          const { version } = sockPkgAlert
          const major = semver.major(version)
          const highest = highestForUpgrade.get(major)?.version ?? '0.0.0'
          if (semver.gt(version, highest)) {
            highestForUpgrade.set(major, sockPkgAlert)
          }
        } else {
          unfixableAlerts.push(sockPkgAlert)
        }
      }
      sockPkgAlerts = [
        ...unfixableAlerts,
        ...highestForCve.values(),
        ...highestForUpgrade.values()
      ]
    }
    sockPkgAlerts.sort((a, b) => naturalCompare(a.type, b.type))
    spinner?.stop()
    if (displayWarning && sockPkgAlerts.length) {
      const lines = new Set()
      const translations = getTranslations()
      for (const sockPkgAlert of sockPkgAlerts) {
        const attributes = [
          ...(sockPkgAlert.fixable ? ['fixable'] : []),
          ...(sockPkgAlert.block ? [] : ['non-blocking'])
        ]
        const maybeAttributes = attributes.length
          ? ` (${attributes.join('; ')})`
          : ''
        // Based data from { pageProps: { alertTypes } } of:
        // https://socket.dev/_next/data/94666139314b6437ee4491a0864e72b264547585/en-US.json
        const info = (translations.alerts as any)[sockPkgAlert.type]
        const title = info?.title ?? sockPkgAlert.type
        const maybeDesc = info?.description ? ` - ${info.description}` : ''
        // TODO: emoji seems to mis-align terminals sometimes
        lines.add(`  ${title}${maybeAttributes}${maybeDesc}\n`)
      }
      output?.write(
        `(socket) ${formatter.hyperlink(
          `${name}@${version}`,
          getSocketDevPackageOverviewUrl(NPM, name, version)
        )} contains risks:\n`
      )
      for (const line of lines) {
        output?.write(line)
      }
    }
    results.push(...sockPkgAlerts)
    decrementRemaining()
  }
  spinner?.stop()
  return results
}

type CveInfoByPackage = Map<
  string,
  {
    firstPatchedVersionIdentifier: string
    vulnerableVersionRange: string
  }[]
>

type GetCveInfoByPackageOptions = {
  excludeUpgrades?: boolean
}

export function getCveInfoByPackage(
  alerts: SocketPackageAlert[],
  options?: GetCveInfoByPackageOptions
): CveInfoByPackage | null {
  const { excludeUpgrades } = <GetCveInfoByPackageOptions>{
    __proto__: null,
    ...options
  }
  let infoByPkg: CveInfoByPackage | null = null
  for (const alert of alerts) {
    if (
      !isArtifactAlertCveFixable(alert.raw) ||
      (excludeUpgrades && getManifestData(NPM, alert.name))
    ) {
      continue
    }
    if (!infoByPkg) {
      infoByPkg = new Map()
    }
    const { name } = alert
    let infos = infoByPkg.get(name)
    if (!infos) {
      infos = []
      infoByPkg.set(name, infos)
    }
    const { firstPatchedVersionIdentifier, vulnerableVersionRange } =
      alert.raw.props
    infos.push({
      firstPatchedVersionIdentifier,
      vulnerableVersionRange
    })
  }
  return infoByPkg
}

export async function updateAdvisoryNodes(
  arb: SafeArborist,
  alerts: SocketPackageAlert[]
) {
  const infoByPkg = getCveInfoByPackage(alerts)
  if (!infoByPkg) {
    // No advisories to process.
    return
  }
  await arb.buildIdealTree()
  const tree = arb.idealTree!
  for (const { 0: name, 1: infos } of infoByPkg) {
    const nodes = findPackageNodes(tree, name)
    const packument =
      nodes.length && infos.length
        ? // eslint-disable-next-line no-await-in-loop
          await fetchPackagePackument(name)
        : null
    if (packument) {
      for (const node of nodes) {
        for (const {
          firstPatchedVersionIdentifier,
          vulnerableVersionRange
        } of infos) {
          updateNode(
            node,
            packument,
            vulnerableVersionRange,
            firstPatchedVersionIdentifier
          )
        }
      }
    }
  }
}

export async function updateSocketRegistryNodes(arb: SafeArborist) {
  await arb.buildIdealTree()
  const tree = arb.idealTree!
  for (const { 1: data } of getManifestData(NPM)) {
    const nodes = findPackageNodes(tree, data.name)
    const packument = nodes.length
      ? // eslint-disable-next-line no-await-in-loop
        await fetchPackagePackument(data.name)
      : null
    if (packument) {
      for (const node of nodes) {
        updateNode(node, packument)
      }
    }
  }
}

export const kRiskyReify = Symbol('riskyReify')

type SafeArborist = ArboristClass & {
  [kRiskyReify](options?: ArboristReifyOptions): Promise<SafeNode>
}

export async function reify(
  this: SafeArborist,
  ...args: Parameters<InstanceType<ArboristClass>['reify']>
): Promise<SafeNode> {
  const { stderr: output, stdin: input } = process
  const alerts = await getPackagesAlerts(this, { output })
  if (
    alerts.length &&
    !(await confirm(
      {
        message: 'Accept risks of installing these packages?',
        default: false
      },
      {
        input,
        output,
        signal: abortSignal
      }
    ))
  ) {
    throw new Error('Socket npm exiting due to risks')
  }
  return await this[kRiskyReify](...args)
}
