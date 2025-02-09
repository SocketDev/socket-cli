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
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { getPackagesToQueryFromDiff } from './diff'
import constants from '../../../../constants'
import {
  batchScan,
  isArtifactAlertCveFixable,
  isArtifactAlertFixable
} from '../../../../utils/alert/artifact'
import { uxLookup } from '../../../../utils/alert/rules'
import { ColorOrMarkdown } from '../../../../utils/color-or-markdown'
import { debugLog } from '../../../../utils/debug'
import { getSocketDevPackageOverviewUrl } from '../../../../utils/socket-url'
import { Edge, SafeEdge } from '../edge'

import type { PackageDetail } from './diff'
import type { ArboristClass, ArboristReifyOptions } from './types'
import type { SocketArtifact } from '../../../../utils/alert/artifact'
import type { SafeNode } from '../node'
import type { Writable } from 'node:stream'

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
  raw?: any
}

const {
  LOOP_SENTINEL,
  NPM,
  NPM_REGISTRY_URL,
  SOCKET_CLI_IN_FIX_CMD,
  SOCKET_CLI_IN_OPTIMIZE_CMD,
  abortSignal,
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { getIPC }
} = constants

const formatter = new ColorOrMarkdown(false)

function findBestPatchVersion(
  name: string,
  availableVersions: string[],
  currentMajorVersion: number,
  vulnerableVersionRange?: string,
  _firstPatchedVersionIdentifier?: string
): string | null {
  const manifestData = getManifestData(NPM, name)
  // Filter versions that are within the current major version and are not in the vulnerable range
  const eligibleVersions =
    manifestData && manifestData.name === manifestData.package
      ? availableVersions
      : availableVersions.filter(
          version =>
            semver.major(version) === currentMajorVersion &&
            (!vulnerableVersionRange ||
              !semver.satisfies(version, vulnerableVersionRange))
        )
  if (eligibleVersions.length === 0) {
    return null
  }
  // Use semver to find the max satisfying version.
  return semver.maxSatisfying(eligibleVersions, '*')
}

function findPackageNodes(tree: SafeNode, packageName: string): SafeNode[] {
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

type GetPackageAlertsOptions = {
  output?: Writable
  includeExisting?: boolean
  includeUnfixable?: boolean
}

async function getPackagesAlerts(
  details: PackageDetail[],
  options?: GetPackageAlertsOptions
): Promise<SocketPackageAlert[]> {
  let { length: remaining } = details
  const IPC = await getIPC()
  const runningFixCmd = !!IPC[SOCKET_CLI_IN_FIX_CMD]
  const needInfoOn = getPackagesToQueryFromDiff(arb.diff, {
    includeUnchanged: runningFixCmd
  })
  const packageAlerts: SocketPackageAlert[] = []
  if (!remaining) {
    return packageAlerts
  }
  const {
    includeExisting = false,
    includeUnfixable = true,
    output
  } = <GetPackageAlertsOptions>{
    __proto__: null,
    ...options
  }
  const spinner = output ? new Spinner({ stream: output }) : undefined
  const getText = spinner
    ? () => `Looking up data for ${remaining} packages`
    : () => ''
  spinner?.start(getText())
  try {
    for await (const artifact of batchScan(
      arrayUnique(details.map(d => d.node.pkgid))
    )) {
      if (!artifact.name || !artifact.version || !artifact.alerts?.length) {
        continue
      }
      const { version } = artifact
      const name = resolvePackageName(<any>artifact)
      const id = `${name}@${artifact.version}`

      let displayWarning = false
      let alerts: SocketPackageAlert[] = []
      for (const alert of artifact.alerts) {
        // eslint-disable-next-line no-await-in-loop
        const ux = await uxLookup({
          package: { name, version },
          alert: { type: alert.type }
        })
        if (ux.display && output) {
          displayWarning = true
        }
        if (ux.block || ux.display) {
          const fixable = isArtifactAlertFixable(alert)
          if (includeUnfixable || fixable) {
            alerts.push({
              name,
              version,
              key: alert.key,
              type: alert.type,
              block: ux.block,
              raw: alert,
              fixable
            })
          }
          if (includeExisting && !runningFixCmd) {
            // Before we ask about problematic issues, check to see if they
            // already existed in the old version if they did, be quiet.
            const existing = details.find(d =>
              d.existing?.pkgid.startsWith(`${name}@`)
            )?.existing
            if (existing) {
              const oldArtifact: SocketArtifact | undefined =
                // eslint-disable-next-line no-await-in-loop
                (await batchScan([existing.pkgid]).next()).value
              if (oldArtifact?.alerts?.length) {
                alerts = alerts.filter(
                  ({ type }) => !oldArtifact.alerts!.find(a => a.type === type)
                )
              }
            }
          }
        }
      }
      if (displayWarning && spinner) {
        spinner.stop(
          `(socket) ${formatter.hyperlink(id, getSocketDevPackageOverviewUrl(NPM, name, version))} contains risks:`
        )
      }
      alerts.sort((a, b) => (a.type < b.type ? -1 : 1))
      if (output) {
        const lines = new Set()
        const translations = getTranslations()
        for (const alert of alerts) {
          const attributes = [
            ...(alert.fixable ? ['fixable'] : []),
            ...(alert.block ? [] : ['non-blocking'])
          ]
          const maybeAttributes = attributes.length
            ? ` (${attributes.join('; ')})`
            : ''
          // Based data from { pageProps: { alertTypes } } of:
          // https://socket.dev/_next/data/94666139314b6437ee4491a0864e72b264547585/en-US.json
          const info = (translations.alerts as any)[alert.type]
          const title = info?.title ?? alert.type
          const maybeDesc = info?.description ? ` - ${info.description}` : ''
          // TODO: emoji seems to mis-align terminals sometimes
          lines.add(`  ${title}${maybeAttributes}${maybeDesc}\n`)
        }
        for (const line of lines) {
          output?.write(line)
        }
      }
      spinner?.start()
      remaining -= 1
      if (spinner) {
        spinner.text = remaining > 0 ? getText() : ''
      }
      packageAlerts.push(...alerts)
    }
  } catch (e) {
    debugLog(e)
  } finally {
    spinner?.stop()
  }
  return packageAlerts
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

async function updateAdvisoryDependencies(
  arb: SafeArborist,
  alerts: SocketPackageAlert[]
) {
  let patchDataByPkg:
    | {
        [key: string]: {
          firstPatchedVersionIdentifier: string
          vulnerableVersionRange: string
        }[]
      }
    | undefined
  for (const alert of alerts) {
    if (!isArtifactAlertCveFixable(alert.raw)) {
      continue
    }
    if (!patchDataByPkg) {
      patchDataByPkg = {}
    }
    const { name } = alert
    if (!patchDataByPkg[name]) {
      patchDataByPkg[name] = []
    }
    const { firstPatchedVersionIdentifier, vulnerableVersionRange } =
      alert.raw.props
    patchDataByPkg[name]!.push({
      firstPatchedVersionIdentifier,
      vulnerableVersionRange
    })
  }
  if (!patchDataByPkg) {
    // No advisories to process.
    return
  }
  await arb.buildIdealTree()
  const tree = arb.idealTree!
  for (const name of Object.keys(patchDataByPkg)) {
    const nodes = findPackageNodes(tree, name)
    const patchData = patchDataByPkg[name]!
    const packument =
      nodes.length && patchData.length
        ? // eslint-disable-next-line no-await-in-loop
          await fetchPackagePackument(name)
        : null
    if (packument) {
      for (const node of nodes) {
        for (const {
          firstPatchedVersionIdentifier,
          vulnerableVersionRange
        } of patchData) {
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

async function updateSocketRegistryDependencies(arb: SafeArborist) {
  await arb.buildIdealTree()
  const manifest = getManifestData(NPM)
  const tree = arb.idealTree!
  for (const { 1: data } of manifest) {
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

function updateNode(
  node: SafeNode,
  packument: Packument,
  vulnerableVersionRange?: string,
  firstPatchedVersionIdentifier?: string
) {
  const { version } = node
  const majorVerNum = semver.major(version)
  const availableVersions = Object.keys(packument.versions)
  // Find the highest non-vulnerable version within the same major range
  const targetVersion = findBestPatchVersion(
    node.name,
    availableVersions,
    majorVerNum,
    vulnerableVersionRange,
    firstPatchedVersionIdentifier
  )
  const targetPackument = targetVersion
    ? packument.versions[targetVersion]
    : undefined
  // Check !targetVersion to make TypeScript happy.
  if (!targetVersion || !targetPackument) {
    // No suitable patch version found.
    return node
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
}

export const kRiskyReify = Symbol('riskyReify')

type SafeArborist = ArboristClass & {
  [kRiskyReify](options?: ArboristReifyOptions): Promise<SafeNode>
}

export async function reify(
  this: SafeArborist,
  ...args: Parameters<InstanceType<ArboristClass>['reify']>
): Promise<SafeNode> {
  const IPC = await getIPC()
  const runningFixCmd = !!IPC[SOCKET_CLI_IN_FIX_CMD]
  const runningOptimizeCmd = !!IPC[SOCKET_CLI_IN_OPTIMIZE_CMD]
  await updateSocketRegistryNodes(this)
  if (runningOptimizeCmd) {
    return await this[kRiskyReify](...args)
  }
  const { stderr: output, stdin: input } = process
  const alerts = await getPackagesAlerts(this, { output })
  if (
    alerts.length &&
    !runningFixCmd &&
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
  if (!alerts.length || !runningFixCommand) {
    return await this[kRiskyReify](...args)
  }
  const prev = new Set(alerts.map(a => a.key))
  let ret: SafeNode | undefined
  /* eslint-disable no-await-in-loop */
  while (alerts.length > 0) {
    await updateAdvisoryDependencies(this, alerts)
    ret = await this[kRiskyReify](...args)
    await this.loadActual()
    await this.buildIdealTree()
    needInfoOn = getPackagesToQueryFromDiff(this.diff, {
      includeUnchanged: true
    })
    alerts = (
      await getPackagesAlerts(needInfoOn, {
        includeExisting: true,
        includeUnfixable: true
      })
    ).filter(({ key }) => {
      const unseen = !prev.has(key)
      if (unseen) {
        prev.add(key)
      }
      return unseen
    })
  }
  /* eslint-enable no-await-in-loop */
  return ret!
}
