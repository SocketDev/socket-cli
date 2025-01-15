import { readFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

import semver from 'semver'

import config from '@socketsecurity/config'
import { getManifestData } from '@socketsecurity/registry'
import { hasOwn, isObject } from '@socketsecurity/registry/lib/objects'
import {
  fetchPackagePackument,
  resolvePackageName
} from '@socketsecurity/registry/lib/packages'
import { confirm } from '@socketsecurity/registry/lib/prompts'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { batchScan, isAlertFixable, isAlertFixableCve, walk } from './alerts'
import { kCtorArgs, kRiskyReify } from './index'
import constants from '../../../../constants'
import { createAlertUXLookup } from '../../../../utils/alert-rules'
import { ColorOrMarkdown } from '../../../../utils/color-or-markdown'
import { isErrnoException } from '../../../../utils/misc'
import { getPublicToken, setupSdk } from '../../../../utils/sdk'
import { getSetting } from '../../../../utils/settings'
import { npmNmPath } from '../../../npm-paths'
import { Edge, SafeEdge } from '../edge'

import type { InstallEffect, SocketArtifact } from './alerts'
import type { ArboristClass, AuditAdvisory, SafeArborist } from './index'
import type { SafeNode } from '../node'
import type { Writable } from 'node:stream'

type AlertUxLookup = ReturnType<typeof createAlertUXLookup>

type AlertUxLookupSettings = Parameters<AlertUxLookup>[0]

type AlertUxLookupResult = ReturnType<AlertUxLookup>

type SocketPackageAlert = {
  key: string
  type: string
  name: string
  version: string
  block: boolean
  fixable: boolean
  raw?: any
}

const pacote: typeof import('pacote') = require(path.join(npmNmPath, 'pacote'))

const {
  ENV,
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

function findPackageRecursively(
  tree: SafeNode,
  packageName: string
): SafeNode | null {
  const queue: { node: typeof tree }[] = [{ node: tree }]
  let sentinel = 0
  while (queue.length) {
    if (sentinel++ === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop in findPackageRecursively')
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

function findSocketYmlSync() {
  let prevDir = null
  let dir = process.cwd()
  while (dir !== prevDir) {
    let ymlPath = path.join(dir, 'socket.yml')
    let yml = maybeReadfileSync(ymlPath)
    if (yml === undefined) {
      ymlPath = path.join(dir, 'socket.yaml')
      yml = maybeReadfileSync(ymlPath)
    }
    if (typeof yml === 'string') {
      try {
        return {
          path: ymlPath,
          parsed: config.parseSocketConfig(yml)
        }
      } catch {
        throw new Error(`Found file but was unable to parse ${ymlPath}`)
      }
    }
    prevDir = dir
    dir = path.join(dir, '..')
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
          if (!fixable && !ENV[SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]) {
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
          `(socket) ${formatter.hyperlink(id, `https://socket.dev/npm/package/${name}/overview/${version}`)} contains risks:`
        )
      }
      alerts.sort((a, b) => (a.type < b.type ? -1 : 1))
      if (output) {
        const lines = new Set()
        const translations = getTranslations()
        for (const alert of alerts) {
          // Based data from { pageProps: { alertTypes } } of:
          // https://socket.dev/_next/data/94666139314b6437ee4491a0864e72b264547585/en-US.json
          const info = (translations.alerts as any)[alert.type]
          const title = info?.title ?? alert.type
          const attributes = [
            ...(alert.fixable ? ['fixable'] : []),
            ...(alert.block ? [] : ['non-blocking'])
          ]
          const maybeAttributes = attributes.length
            ? ` (${attributes.join('; ')})`
            : ''
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

function maybeReadfileSync(filepath: string): string | undefined {
  try {
    return readFileSync(filepath, 'utf8')
  } catch {}
  return undefined
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
    const node = findPackageRecursively(tree, name)
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
      node.resolved = `https://registry.npmjs.org/${name}/-/${name}-${targetVersion}.tgz`
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

let _uxLookup: AlertUxLookup | undefined
async function uxLookup(
  settings: AlertUxLookupSettings
): Promise<AlertUxLookupResult> {
  while (_uxLookup === undefined) {
    // eslint-disable-next-line no-await-in-loop
    await wait(1, { signal: abortSignal })
  }
  return _uxLookup(settings)
}

export async function reify(
  this: SafeArborist,
  ...args: Parameters<InstanceType<ArboristClass>['reify']>
): Promise<SafeNode> {
  // `this.diff` is `null` when `options.packageLockOnly`, --package-lock-only,
  // is `true`.
  const needInfoOn = this.diff ? walk(this.diff) : []
  if (needInfoOn.findIndex(c => c.repository_url === NPM_REGISTRY_URL) === -1) {
    // Nothing to check, hmmm already installed or all private?
    return await this[kRiskyReify](...args)
  }
  const input = process.stdin
  const output = process.stderr
  let alerts: SocketPackageAlert[] | undefined
  const proceed =
    ENV[SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE] ||
    (await (async () => {
      alerts = await getPackagesAlerts(this, needInfoOn, { output })
      if (!alerts.length || ENV[SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]) {
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
      (ENV[SOCKET_CLI_FIX_PACKAGE_LOCK_FILE] ||
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
          this.diff ? walk(this.diff, { fix: true }) : [],
          { fixable: true }
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

void (async () => {
  const { orgs, settings } = await (async () => {
    try {
      const socketSdk = await setupSdk(getPublicToken())
      const orgResult = await socketSdk.getOrganizations()
      if (!orgResult.success) {
        throw new Error(
          `Failed to fetch Socket organization info: ${orgResult.error.message}`
        )
      }
      const orgs: Exclude<
        (typeof orgResult.data.organizations)[string],
        undefined
      >[] = []
      for (const org of Object.values(orgResult.data.organizations)) {
        if (org) {
          orgs.push(org)
        }
      }
      const result = await socketSdk.postSettings(
        orgs.map(org => ({ organization: org.id }))
      )
      if (!result.success) {
        throw new Error(
          `Failed to fetch API key settings: ${result.error.message}`
        )
      }
      return {
        orgs,
        settings: result.data
      }
    } catch (e: any) {
      const cause = isObject(e) && 'cause' in e ? e.cause : undefined
      if (
        isErrnoException(cause) &&
        (cause.code === 'ENOTFOUND' || cause.code === 'ECONNREFUSED')
      ) {
        throw new Error(
          'Unable to connect to socket.dev, ensure internet connectivity before retrying',
          {
            cause: e
          }
        )
      }
      throw e
    }
  })()

  // Remove any organizations not being enforced.
  const enforcedOrgs = getSetting('enforcedOrgs') ?? []
  for (const { 0: i, 1: org } of orgs.entries()) {
    if (!enforcedOrgs.includes(org.id)) {
      settings.entries.splice(i, 1)
    }
  }

  const socketYml = findSocketYmlSync()
  if (socketYml) {
    settings.entries.push({
      start: socketYml.path,
      settings: {
        [socketYml.path]: {
          deferTo: null,
          // TODO: TypeScript complains about the type not matching. We should
          // figure out why are providing
          // issueRules: { [issueName: string]: boolean }
          // but expecting
          // issueRules: { [issueName: string]: { action: 'defer' | 'error' | 'ignore' | 'monitor' | 'warn' } }
          issueRules: (<unknown>socketYml.parsed.issueRules) as {
            [key: string]: {
              action: 'defer' | 'error' | 'ignore' | 'monitor' | 'warn'
            }
          }
        }
      }
    })
  }
  _uxLookup = createAlertUXLookup(settings)
})()
