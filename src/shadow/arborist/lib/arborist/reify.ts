import path from 'node:path'
import process from 'node:process'

import semver from 'semver'

import { getManifestData } from '@socketsecurity/registry'
import { hasOwn } from '@socketsecurity/registry/lib/objects'
import {
  fetchPackagePackument,
  resolvePackageName
} from '@socketsecurity/registry/lib/packages'
import { confirm } from '@socketsecurity/registry/lib/prompts'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { batchScan, isAlertFixable, isAlertFixableCve, walk } from './alerts'
import { kCtorArgs, kRiskyReify } from './index'
import constants from '../../../../constants'
import { uxLookup } from '../../../../utils/alert-rules'
import { ColorOrMarkdown } from '../../../../utils/color-or-markdown'
import { debugLog } from '../../../../utils/debug'
import { getSocketDevPackageOverviewUrl } from '../../../../utils/socket-url'
import { pacotePath } from '../../../npm-paths'
import { Edge, SafeEdge } from '../edge'

import type { InstallEffect, SocketArtifact } from './alerts'
import type { ArboristClass, AuditAdvisory, SafeArborist } from './index'
import type { SafeNode } from '../node'
import type { Writable } from 'node:stream'

type SocketPackageAlert = {
  key: string
  type: string
  name: string
  version: string
  block: boolean
  fixable: boolean
  raw?: any
}

const pacote: typeof import('pacote') = require(pacotePath)

const {
  LOOP_SENTINEL,
  NPM,
  NPM_REGISTRY_URL,
  SOCKET_CLI_FIX_PACKAGE_LOCK_FILE,
  SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE,
  abortSignal
} = constants

const formatter = new ColorOrMarkdown(false)

function findBestPatchVersion(
  name: string,
  availableVersions: string[],
  currentMajorVersion: number,
  vulnerableRange: string
): string | null {
  const manifestVersion = getManifestData(NPM, name)?.version
  // Filter versions that are within the current major version and are not in the vulnerable range
  const eligibleVersions = availableVersions.filter(version => {
    const isSameMajor = semver.major(version) === currentMajorVersion
    const isNotVulnerable = !semver.satisfies(version, vulnerableRange)
    if (isSameMajor && isNotVulnerable) {
      return true
    }
    return !!manifestVersion
  })
  if (eligibleVersions.length === 0) {
    return null
  }
  // Use semver to find the max satisfying version.
  return semver.maxSatisfying(eligibleVersions, '*')
}

function findPackage(tree: SafeNode, packageName: string): SafeNode | null {
  const queue: { node: typeof tree }[] = [{ node: tree }]
  let sentinel = 0
  while (queue.length) {
    if (sentinel++ === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in findPackage')
    }
    const { node: currentNode } = queue.pop()!
    const node = currentNode.children.get(packageName)
    if (node) {
      // Found package.
      return (<unknown>node) as SafeNode
    }
    const children = [...currentNode.children.values()]
    for (let i = children.length - 1; i >= 0; i -= 1) {
      queue.push({ node: (<unknown>children[i]) as SafeNode })
    }
  }
  return null
}

type GetPackageAlertsOptions = {
  output?: Writable
  fixable?: boolean
}

async function getPackagesAlerts(
  safeArb: SafeArborist,
  pkgs: InstallEffect[],
  options?: GetPackageAlertsOptions
): Promise<SocketPackageAlert[]> {
  let { length: remaining } = pkgs
  const packageAlerts: SocketPackageAlert[] = []
  if (!remaining) {
    return packageAlerts
  }
  const { fixable, output } = <GetPackageAlertsOptions>{
    __proto__: null,
    ...options
  }
  const spinner = output ? new Spinner({ stream: output }) : undefined
  const getText = spinner
    ? () => `Looking up data for ${remaining} packages`
    : () => ''
  spinner?.start(getText())
  try {
    for await (const artifact of batchScan(pkgs.map(p => p.pkgid))) {
      if (!artifact.name || !artifact.version || !artifact.alerts?.length) {
        continue
      }
      const { version } = artifact
      const name = resolvePackageName(<any>artifact)
      const id = `${name}@${artifact.version}`

      let blocked = false
      let displayWarning = false
      let alerts: SocketPackageAlert[] = []
      for (const alert of artifact.alerts) {
        // eslint-disable-next-line no-await-in-loop
        const ux = await uxLookup({
          package: { name, version },
          alert: { type: alert.type }
        })
        if (ux.block) {
          blocked = true
        }
        if (ux.display && output) {
          displayWarning = true
        }
        if (ux.block || ux.display) {
          const isFixable = isAlertFixable(alert)
          if (!fixable || isFixable) {
            alerts.push({
              name,
              version,
              key: alert.key,
              type: alert.type,
              block: ux.block,
              raw: alert,
              fixable: isFixable
            })
          }
          // Lazily access constants.IPC.
          if (!fixable && !constants.IPC[SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]) {
            // Before we ask about problematic issues, check to see if they
            // already existed in the old version if they did, be quiet.
            const existing = pkgs.find(p =>
              p.existing?.startsWith(`${name}@`)
            )?.existing
            if (existing) {
              const oldArtifact: SocketArtifact | undefined =
                // eslint-disable-next-line no-await-in-loop
                (await batchScan([existing]).next()).value
              if (oldArtifact?.alerts?.length) {
                alerts = alerts.filter(
                  ({ type }) => !oldArtifact.alerts?.find(a => a.type === type)
                )
              }
            }
          }
        }
      }
      if (!blocked) {
        const pkg = pkgs.find(p => p.pkgid === id)
        if (pkg) {
          await pacote.tarball.stream(
            id,
            stream => {
              stream.resume()
              return (stream as any).promise()
            },
            { ...(safeArb as any)[kCtorArgs][0] }
          )
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

function packageAlertsToReport(alerts: SocketPackageAlert[]) {
  let report: { [dependency: string]: AuditAdvisory[] } | null = null
  for (const alert of alerts) {
    if (!isAlertFixableCve(alert.raw)) {
      continue
    }
    const { name } = alert
    if (!report) {
      report = {}
    }
    if (!report[name]) {
      report[name] = []
    }
    const props = alert.raw?.props
    report[name]!.push(<AuditAdvisory>{
      id: -1,
      url: props?.url,
      title: props?.title,
      severity: alert.raw?.severity?.toLowerCase(),
      vulnerable_versions: props?.vulnerableVersionRange,
      cwe: props?.cwes,
      cvss: props?.csvs,
      name
    })
  }
  return report
}

async function updateAdvisoryDependencies(
  arb: SafeArborist,
  alerts: SocketPackageAlert[]
) {
  const report = packageAlertsToReport(alerts)
  if (!report) {
    // No advisories to process.
    return
  }
  await arb.buildIdealTree()
  const tree = arb.idealTree!

  for (const name of Object.keys(report)) {
    const advisories = report[name]!
    const node = findPackage(tree, name)
    if (!node) {
      // Package not found in the tree.
      continue
    }

    const { version } = node
    const majorVerNum = semver.major(version)

    // Fetch packument to get available versions.
    // eslint-disable-next-line no-await-in-loop
    const packument = await fetchPackagePackument(name)
    const availableVersions = packument ? Object.keys(packument.versions) : []

    for (const advisory of advisories) {
      const { vulnerable_versions } = advisory
      // Find the highest non-vulnerable version within the same major range
      const targetVersion = findBestPatchVersion(
        name,
        availableVersions,
        majorVerNum,
        vulnerable_versions
      )
      const targetPackument = targetVersion
        ? packument.versions[targetVersion]
        : undefined
      // Check !targetVersion to make TypeScript happy.
      if (!targetVersion || !targetPackument) {
        // No suitable patch version found.
        continue
      }

      // Use Object.defineProperty to override the version.
      Object.defineProperty(node, 'version', {
        configurable: true,
        enumerable: true,
        get: () => targetVersion
      })
      node.package.version = targetVersion
      // Update resolved and clear integrity for the new version.
      node.resolved = `${NPM_REGISTRY_URL}/${name}/-/${name}-${targetVersion}.tgz`
      if (node.integrity) {
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
          node.addEdgeOut(
            (<unknown>new Edge({
              from: node,
              name: newDepName,
              spec: newDeps[newDepName],
              type: 'prod'
            })) as SafeEdge
          )
        }
      }
    }
  }
}

export async function reify(
  this: SafeArborist,
  ...args: Parameters<InstanceType<ArboristClass>['reify']>
): Promise<SafeNode> {
  const needInfoOn = await walk(this.diff)
  if (
    !needInfoOn.length ||
    needInfoOn.findIndex(c => c.repository_url === NPM_REGISTRY_URL) === -1
  ) {
    // Nothing to check, hmmm already installed or all private?
    return await this[kRiskyReify](...args)
  }
  // Lazily access constants.IPC.
  const {
    [SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]: bypassConfirms,
    [SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE]: bypassAlerts
  } = constants.IPC
  const { stderr: output, stdin: input } = process

  let alerts: SocketPackageAlert[] | undefined
  const proceed =
    bypassAlerts ||
    (await (async () => {
      alerts = await getPackagesAlerts(this, needInfoOn, { output })
      if (bypassConfirms || !alerts.length) {
        return true
      }
      return await confirm(
        {
          message: 'Accept risks of installing these packages?',
          default: false
        },
        {
          input,
          output,
          signal: abortSignal
        }
      )
    })())
  if (proceed) {
    const fix =
      !!alerts?.length &&
      (bypassConfirms ||
        (await confirm(
          {
            message: 'Try to fix alerts?',
            default: true
          },
          {
            input,
            output,
            signal: abortSignal
          }
        )))
    if (fix) {
      let ret: SafeNode | undefined
      const prev = new Set(alerts?.map(a => a.key))
      /* eslint-disable no-await-in-loop */
      while (alerts!.length > 0) {
        await updateAdvisoryDependencies(this, alerts!)
        ret = await this[kRiskyReify](...args)
        await this.loadActual()
        await this.buildIdealTree()
        alerts = await getPackagesAlerts(
          this,
          await walk(this.diff, { fix: true }),
          {
            fixable: true
          }
        )
        alerts = alerts.filter(a => {
          const { key } = a
          if (prev.has(key)) {
            return false
          }
          prev.add(key)
          return true
        })
      }
      /* eslint-enable no-await-in-loop */
      return ret!
    }
    return await this[kRiskyReify](...args)
  } else {
    throw new Error('Socket npm exiting due to risks')
  }
}
