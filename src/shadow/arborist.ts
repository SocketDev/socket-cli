import events from 'node:events'
import { readFileSync, realpathSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import rl from 'node:readline'
import { setTimeout as wait } from 'node:timers/promises'

import npa from 'npm-package-arg'
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

import constants from '../constants'
import { createAlertUXLookup } from '../utils/alert-rules'
import { ColorOrMarkdown } from '../utils/color-or-markdown'
import { isErrnoException } from '../utils/misc'
import { findRoot } from '../utils/path-resolve'
import { getDefaultKey, setupSdk } from '../utils/sdk'
import { getSetting } from '../utils/settings'

import type {
  Options as ArboristOptions,
  Advisory as BaseAdvisory,
  Arborist as BaseArborist,
  AuditReport as BaseAuditReport,
  Edge as BaseEdge,
  Node as BaseNode,
  DependencyProblem,
  Diff,
  Link as LinkNode
} from '@npmcli/arborist'
import type { Writable } from 'node:stream'
import type { AliasResult, RegistryResult } from 'npm-package-arg'

type AlertUxLookup = ReturnType<typeof createAlertUXLookup>

type AlertUxLookupSettings = Parameters<AlertUxLookup>[0]

type AlertUxLookupResult = ReturnType<AlertUxLookup>

type ArboristClass = ArboristInstance & {
  new (...args: any): ArboristInstance
}

type ArboristInstance = Omit<typeof BaseArborist, 'auditReport'> & {
  auditReport?: AuditReportInstance | null
}

type AuditReportInstance = Omit<BaseAuditReport, 'report'> & {
  report: { [dependency: string]: AuditAdvisory[] }
}

type AuditAdvisory = Omit<BaseAdvisory, 'id'> & {
  id: number
  cwe: string[]
  cvss: {
    score: number
    vectorString: string
  }
  vulnerable_versions: string
}

type EdgeClass = Omit<BaseEdge, 'overrides' | 'reload'> & {
  optional: boolean
  overrides: OverrideSetClass | undefined
  peer: boolean
  peerConflicted: boolean
  rawSpec: string
  get spec(): string
  get to(): NodeClass | null
  new (...args: any): EdgeClass
  reload(hard?: boolean): void
  satisfiedBy(node: NodeClass): boolean
}

type EdgeOptions = {
  type: string
  name: string
  spec: string
  from: NodeClass
  accept?: string | undefined
  overrides?: OverrideSetClass | undefined
  to?: NodeClass
}

type ErrorStatus = DependencyProblem | 'OK'

type Explanation = {
  type: string
  name: string
  spec: string
  bundled: boolean
  overridden: boolean
  error: ErrorStatus | undefined
  rawSpec: string | undefined
  from: object | undefined
} | null

type InstallEffect = {
  pkgid: NodeClass['pkgid']
  repository_url: string
  existing?: NodeClass['pkgid'] | undefined
}

type NodeClass = Omit<
  BaseNode,
  | 'edgesIn'
  | 'edgesOut'
  | 'from'
  | 'integrity'
  | 'isTop'
  | 'parent'
  | 'resolve'
  | 'root'
> & {
  name: string
  version: string
  edgesIn: Set<SafeEdge>
  edgesOut: Map<string, SafeEdge>
  from: NodeClass | null
  hasShrinkwrap: boolean
  inShrinkwrap: boolean | undefined
  integrity?: string | null
  isTop: boolean | undefined
  meta: BaseNode['meta'] & {
    addEdge(edge: SafeEdge): void
  }
  overrides: OverrideSetClass | undefined
  parent: NodeClass | null
  versions: string[]
  get inDepBundle(): boolean
  get packageName(): string | null
  get resolveParent(): NodeClass | null
  get root(): NodeClass | null
  set root(value: NodeClass | null)
  new (...args: any): NodeClass
  addEdgeIn(edge: SafeEdge): void
  addEdgeOut(edge: SafeEdge): void
  canDedupe(preferDedupe: boolean): boolean
  canReplace(node: NodeClass, ignorePeers?: string[]): boolean
  canReplaceWith(node: NodeClass, ignorePeers?: string[]): boolean
  deleteEdgeIn(edge: SafeEdge): void
  matches(node: NodeClass): boolean
  recalculateOutEdgesOverrides(): void
  resolve(name: string): NodeClass
  updateOverridesEdgeInAdded(
    otherOverrideSet: OverrideSetClass | undefined
  ): boolean
  updateOverridesEdgeInRemoved(otherOverrideSet: OverrideSetClass): boolean
}

interface OverrideSetClass {
  children: Map<string, OverrideSetClass>
  key: string | undefined
  keySpec: string | undefined
  name: string | undefined
  parent: OverrideSetClass | undefined
  value: string | undefined
  version: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-misused-new
  new (...args: any[]): OverrideSetClass
  get isRoot(): boolean
  get ruleset(): Map<string, OverrideSetClass>
  ancestry(): Generator<OverrideSetClass>
  childrenAreEqual(otherOverrideSet: OverrideSetClass | undefined): boolean
  getEdgeRule(edge: SafeEdge): OverrideSetClass
  getNodeRule(node: NodeClass): OverrideSetClass
  getMatchingRule(node: NodeClass): OverrideSetClass | null
  isEqual(otherOverrideSet: OverrideSetClass | undefined): boolean
}

type SocketAlert = {
  key: string
  type: string
  severity: string
  category: string
  action?: string
  actionPolicyIndex?: number
  file?: string
  props?: any
  start?: number
  end?: number
}

type SocketArtifact = {
  type: string
  namespace?: string
  name?: string
  version?: string
  subpath?: string
  release?: string
  id?: string
  author?: string[]
  license?: string
  licenseDetails?: {
    spdxDisj: string
    provenance: string
    filepath: string
    match_strength: number
  }[]
  licenseAttrib?: {
    attribText: string
    attribData: {
      purl: string
      foundInFilepath: string
      spdxExpr: string
      foundAuthors: string[]
    }[]
  }[]
  score?: {
    supplyChain: number
    quality: number
    maintenance: number
    vulnerability: number
    license: number
    overall: number
  }
  alerts?: SocketAlert[]
  size?: number
  batchIndex?: number
}

type SocketPackageAlert = {
  type: string
  name: string
  version: string
  block: boolean
  fixable: boolean
  raw?: any
}

interface KnownModules {
  npmlog: typeof import('npmlog')
  'proc-log': typeof import('proc-log')
}

type RequireTransformer<T extends keyof KnownModules> = (
  mod: KnownModules[T]
) => KnownModules[T]

const {
  API_V0_URL,
  ENV,
  LOOP_SENTINEL,
  NPM,
  NPM_REGISTRY_URL,
  SOCKET_CLI_FIX_PACKAGE_LOCK_FILE,
  SOCKET_CLI_ISSUES_URL,
  SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE,
  SOCKET_PUBLIC_API_KEY,
  abortSignal,
  rootPath
} = constants

const POTENTIAL_BUG_ERROR_MESSAGE = `This is may be a bug with socket-npm related to changes to the npm CLI.\nPlease report to ${SOCKET_CLI_ISSUES_URL}.`

const npmEntrypoint = realpathSync(process.argv[1]!)
const npmRootPath = findRoot(path.dirname(npmEntrypoint))

function tryRequire<T extends keyof KnownModules>(
  ...ids: (T | [T, RequireTransformer<T>])[]
): KnownModules[T] | undefined {
  for (const data of ids) {
    let id: string | undefined
    let transformer: RequireTransformer<T> | undefined
    if (Array.isArray(data)) {
      id = data[0]
      transformer = <RequireTransformer<T>>data[1]
    } else {
      id = <keyof KnownModules>data
      transformer = mod => mod
    }
    try {
      // Check that the transformed value isn't `undefined` because older
      // versions of packages like 'proc-log' may not export a `log` method.
      const exported = transformer(require(id)) as KnownModules[T]
      if (exported !== undefined) {
        return exported
      }
    } catch {}
  }
  return undefined
}

if (npmRootPath === undefined) {
  console.error(
    `Unable to find npm CLI install directory.\nSearched parent directories of ${npmEntrypoint}.\n\n${POTENTIAL_BUG_ERROR_MESSAGE}`
  )
  // The exit code 127 indicates that the command or binary being executed
  // could not be found.
  process.exit(127)
}

const npmNmPath = path.join(npmRootPath, 'node_modules')

const arboristPkgPath = path.join(npmNmPath, '@npmcli/arborist')
const arboristClassPath = path.join(arboristPkgPath, 'lib/arborist/index.js')
const arboristDepValidPath = path.join(arboristPkgPath, 'lib/dep-valid.js')
const arboristEdgeClassPath = path.join(arboristPkgPath, 'lib/edge.js')
const arboristNodeClassPath = path.join(arboristPkgPath, 'lib/node.js')
const arboristOverrideSetClassPatch = path.join(
  arboristPkgPath,
  'lib/override-set.js'
)

const log = tryRequire(
  [
    <'proc-log'>path.join(npmNmPath, 'proc-log/lib/index.js'),
    // The proc-log DefinitelyTyped definition is incorrect. The type definition
    // is really that of its export log.
    mod => <KnownModules['proc-log']>(mod as any).log
  ],
  <'npmlog'>path.join(npmNmPath, 'npmlog/lib/log.js')
)

const pacote: typeof import('pacote') = require(path.join(npmNmPath, 'pacote'))
const translations: typeof import('../../translations.json') = require(
  path.join(rootPath, 'translations.json')
)

const Arborist: ArboristClass = require(arboristClassPath)
const depValid: (
  child: NodeClass,
  requested: string,
  accept: string | undefined,
  requester: NodeClass
) => boolean = require(arboristDepValidPath)
const Edge: EdgeClass = require(arboristEdgeClassPath)
const Node: NodeClass = require(arboristNodeClassPath)
const OverrideSet: OverrideSetClass = require(arboristOverrideSetClassPatch)

const kCtorArgs = Symbol('ctorArgs')
const kRiskyReify = Symbol('riskyReify')

const formatter = new ColorOrMarkdown(false)
const pubToken = getDefaultKey() ?? SOCKET_PUBLIC_API_KEY

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

async function* batchScan(pkgIds: string[]): AsyncGenerator<SocketArtifact> {
  const req = https
    .request(`${API_V0_URL}/purl?alerts=true`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${pubToken}:`).toString('base64url')}`
      },
      signal: abortSignal
    })
    .end(
      JSON.stringify({
        components: pkgIds.map(id => ({ purl: `pkg:npm/${id}` }))
      })
    )
  const { 0: res } = await events.once(req, 'response')
  const ok = res.statusCode >= 200 && res.statusCode <= 299
  if (!ok) {
    throw new Error(`Socket API Error: ${res.statusCode}`)
  }
  const rli = rl.createInterface(res)
  for await (const line of rli) {
    yield JSON.parse(line)
  }
}

// Patch adding doOverrideSetsConflict is based on
// https://github.com/npm/cli/pull/7025.
function doOverrideSetsConflict(
  first: OverrideSetClass | undefined,
  second: OverrideSetClass | undefined
) {
  // If override sets contain one another then we can try to use the more specific
  // one. However, if neither one is more specific, then we consider them to be
  // in conflict.
  return findSpecificOverrideSet(first, second) === undefined
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

// Patch adding findSpecificOverrideSet is based on
// https://github.com/npm/cli/pull/7025.
function findSpecificOverrideSet(
  first: OverrideSetClass | undefined,
  second: OverrideSetClass | undefined
) {
  let overrideSet = second
  while (overrideSet) {
    if (overrideSet.isEqual(first)) {
      return second
    }
    overrideSet = overrideSet.parent
  }
  overrideSet = first
  while (overrideSet) {
    if (overrideSet.isEqual(second)) {
      return first
    }
    overrideSet = overrideSet.parent
  }
  // The override sets are incomparable. Neither one contains the other.
  log?.silly('Conflicting override sets', first, second)
  return undefined
}

function isAlertFixable(alert: SocketAlert): boolean {
  return alert.type === 'socketUpgradeAvailable' || isAlertFixableCve(alert)
}

function isAlertFixableCve(alert: SocketAlert): boolean {
  const { type } = alert
  return (
    (type === 'cve' ||
      type === 'mediumCVE' ||
      type === 'mildCVE' ||
      type === 'criticalCVE') &&
    !!alert.props?.['firstPatchedVersionIdentifier']
  )
}

function maybeReadfileSync(filepath: string): string | undefined {
  try {
    return readFileSync(filepath, 'utf8')
  } catch {}
  return undefined
}

async function getPackagesAlerts(
  safeArb: SafeArborist,
  pkgs: InstallEffect[],
  output?: Writable
): Promise<SocketPackageAlert[]> {
  const spinner = new Spinner({
    stream: output
  })
  let { length: remaining } = pkgs
  const packageAlerts: SocketPackageAlert[] = []
  if (!remaining) {
    spinner.success('No changes detected')
    return packageAlerts
  }
  const getText = () => `Looking up data for ${remaining} packages`
  spinner.start(getText())

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
        if (ux.display) {
          displayWarning = true
        }
        if (ux.block || ux.display) {
          alerts.push({
            name,
            version,
            type: alert.type,
            block: ux.block,
            raw: alert,
            fixable: isAlertFixable(alert)
          })
          if (!ENV[SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]) {
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
      if (displayWarning) {
        spinner.stop(
          `(socket) ${formatter.hyperlink(id, `https://socket.dev/npm/package/${name}/overview/${version}`)} contains risks:`
        )
        alerts.sort((a, b) => (a.type < b.type ? -1 : 1))
        const lines = new Set()
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
        spinner.start()
      }
      remaining -= 1
      spinner.text = remaining > 0 ? getText() : ''
      packageAlerts.push(...alerts)
    }
  } finally {
    spinner.stop()
  }
  return packageAlerts
}

function toRepoUrl(resolved: string): string {
  try {
    return URL.parse(resolved)?.origin ?? ''
  } catch {}
  return ''
}

function walk(diff_: Diff): InstallEffect[] {
  const needInfoOn: InstallEffect[] = []
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
      // The `oldNode`, i.e. `actual` node, may be `undefined` if there is no
      // node_modules folder.
      const { actual: oldNode, ideal: pkgNode } = diff
      const { pkgid } = pkgNode

      let existing
      let keep = false
      if (action === 'CHANGE') {
        if (pkgNode?.package.version !== oldNode?.package.version) {
          keep = true
          if (
            oldNode?.package.name &&
            oldNode.package.name === pkgNode?.package.name
          ) {
            existing = oldNode.pkgid
          }
        } else {
          // TODO: Add proper debug mode.
          // console.warn('SKIPPING META CHANGE ON', diff)
        }
      } else {
        keep = action !== 'REMOVE'
      }
      if (keep && pkgid && pkgNode.resolved && (!oldNode || oldNode.resolved)) {
        needInfoOn.push({
          existing,
          pkgid,
          repository_url: toRepoUrl(pkgNode.resolved)
        })
      }
    }
    for (const child of diff.children) {
      queue[queueLength++] = child
    }
  }
  if (ENV[SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]) {
    const { unchanged } = diff_!
    for (let i = 0, { length } = unchanged; i < length; i += 1) {
      const pkgNode = unchanged[i]!
      needInfoOn.push({
        existing: pkgNode.pkgid,
        pkgid: pkgNode.pkgid,
        repository_url: toRepoUrl(pkgNode.resolved!)
      })
    }
  }
  return needInfoOn
}

// The Edge class makes heavy use of private properties which subclasses do NOT
// have access to. So we have to recreate any functionality that relies on those
// private properties and use our own "safe" prefixed non-conflicting private
// properties. Implementation code not related to patch https://github.com/npm/cli/pull/7025
// is based on https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/edge.js.
//
// The npm application
// Copyright (c) npm, Inc. and Contributors
// Licensed on the terms of The Artistic License 2.0
//
// An edge in the dependency graph.
// Represents a dependency relationship of some kind.
const initializedSafeEdges = new WeakSet()

class SafeEdge extends Edge {
  #safeAccept: string | undefined
  #safeError: ErrorStatus | null
  #safeExplanation: Explanation | undefined
  #safeFrom: NodeClass | null
  #safeName: string
  #safeTo: NodeClass | null

  constructor(options: EdgeOptions) {
    const { accept, from, name } = options
    // Defer to supper to validate options and assign non-private values.
    super(options)
    if (accept !== undefined) {
      this.#safeAccept = accept || '*'
    }
    if (from.constructor !== SafeNode) {
      Reflect.setPrototypeOf(from, SafeNode.prototype)
    }
    this.#safeError = null
    this.#safeExplanation = null
    this.#safeFrom = from
    this.#safeName = name
    this.#safeTo = null
    initializedSafeEdges.add(this)
    this.reload(true)
  }

  get accept() {
    return this.#safeAccept
  }

  get bundled() {
    return !!this.#safeFrom?.package?.bundleDependencies?.includes(this.name)
  }

  override get error() {
    if (!this.#safeError) {
      if (!this.#safeTo) {
        if (this.optional) {
          this.#safeError = null
        } else {
          this.#safeError = 'MISSING'
        }
      } else if (
        this.peer &&
        this.#safeFrom === this.#safeTo.parent &&
        !this.#safeFrom?.isTop
      ) {
        this.#safeError = 'PEER LOCAL'
      } else if (!this.satisfiedBy(this.#safeTo)) {
        this.#safeError = 'INVALID'
      }
      // Patch adding "else if" condition is based on
      // https://github.com/npm/cli/pull/7025.
      else if (
        this.overrides &&
        this.#safeTo.edgesOut.size &&
        doOverrideSetsConflict(this.overrides, this.#safeTo.overrides)
      ) {
        // Any inconsistency between the edge's override set and the target's
        // override set is potentially problematic. But we only say the edge is
        // in error if the override sets are plainly conflicting. Note that if
        // the target doesn't have any dependencies of their own, then this
        // inconsistency is irrelevant.
        this.#safeError = 'INVALID'
      } else {
        this.#safeError = 'OK'
      }
    }
    if (this.#safeError === 'OK') {
      return null
    }
    return this.#safeError
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get from() {
    return this.#safeFrom
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get spec(): string {
    if (
      this.overrides?.value &&
      this.overrides.value !== '*' &&
      this.overrides.name === this.name
    ) {
      // Patch adding "if" condition is based on
      // https://github.com/npm/cli/pull/7025.
      //
      // If this edge has the same overrides field as the source, then we're not
      // applying an override for this edge.
      if (this.overrides === this.#safeFrom?.overrides) {
        // The Edge rawSpec getter will retrieve the private Edge #spec property.
        return this.rawSpec
      }
      if (this.overrides.value.startsWith('$')) {
        const ref = this.overrides.value.slice(1)
        // We may be a virtual root, if we are we want to resolve reference
        // overrides from the real root, not the virtual one.
        const pkg = this.#safeFrom?.sourceReference
          ? this.#safeFrom.sourceReference.root.package
          : this.#safeFrom?.root?.package
        if (pkg?.devDependencies?.[ref]) {
          return <string>pkg.devDependencies[ref]
        }
        if (pkg?.optionalDependencies?.[ref]) {
          return <string>pkg.optionalDependencies[ref]
        }
        if (pkg?.dependencies?.[ref]) {
          return <string>pkg.dependencies[ref]
        }
        if (pkg?.peerDependencies?.[ref]) {
          return <string>pkg.peerDependencies[ref]
        }
        throw new Error(`Unable to resolve reference ${this.overrides.value}`)
      }
      return this.overrides.value
    }
    return this.rawSpec
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get to() {
    return this.#safeTo
  }

  detach() {
    this.#safeExplanation = null
    // Patch replacing
    // if (this.#safeTo) {
    //   this.#safeTo.edgesIn.delete(this)
    // }
    // is based on https://github.com/npm/cli/pull/7025.
    this.#safeTo?.deleteEdgeIn(this)
    this.#safeFrom?.edgesOut.delete(this.name)
    this.#safeTo = null
    this.#safeError = 'DETACHED'
    this.#safeFrom = null
  }

  // Return the edge data, and an explanation of how that edge came to be here.
  // @ts-ignore: Edge#explain is defined with an unused `seen = []` param.
  override explain() {
    if (!this.#safeExplanation) {
      const explanation: Explanation = {
        type: this.type,
        name: this.name,
        spec: this.spec,
        bundled: false,
        overridden: false,
        error: undefined,
        from: undefined,
        rawSpec: undefined
      }
      if (this.rawSpec !== this.spec) {
        explanation.rawSpec = this.rawSpec
        explanation.overridden = true
      }
      if (this.bundled) {
        explanation.bundled = this.bundled
      }
      if (this.error) {
        explanation.error = this.error
      }
      if (this.#safeFrom) {
        explanation.from = this.#safeFrom.explain()
      }
      this.#safeExplanation = explanation
    }
    return this.#safeExplanation
  }

  override reload(hard = false) {
    if (!initializedSafeEdges.has(this)) {
      // Skip if called during super constructor.
      return
    }
    this.#safeExplanation = null
    // Patch adding newOverrideSet and oldOverrideSet is based on
    // https://github.com/npm/cli/pull/7025.
    let newOverrideSet
    let oldOverrideSet
    if (this.#safeFrom?.overrides) {
      // Patch replacing
      // this.overrides = this.#safeFrom.overrides.getEdgeRule(this)
      // is based on https://github.com/npm/cli/pull/7025.
      const newOverrideSet = this.#safeFrom.overrides.getEdgeRule(this)
      if (newOverrideSet && !newOverrideSet.isEqual(this.overrides)) {
        // If there's a new different override set we need to propagate it to
        // the nodes. If we're deleting the override set then there's no point
        // propagating it right now since it will be filled with another value
        // later.
        oldOverrideSet = this.overrides
        this.overrides = newOverrideSet
      }
    } else {
      this.overrides = undefined
    }
    const newTo = this.#safeFrom?.resolve(this.name)
    if (newTo !== this.#safeTo) {
      // Patch replacing
      // if (this.#safeTo) {
      //   this.#safeTo.edgesIn.delete(this)
      // }
      // is based on https://github.com/npm/cli/pull/7025.
      this.#safeTo?.deleteEdgeIn(this)
      this.#safeTo = <NodeClass>newTo ?? null
      this.#safeError = null
      this.#safeTo?.addEdgeIn(this)
    } else if (hard) {
      this.#safeError = null
    }
    // Patch adding "else if" condition based on
    // https://github.com/npm/cli/pull/7025
    else if (oldOverrideSet) {
      // Propagate the new override set to the target node.
      this.#safeTo.updateOverridesEdgeInRemoved(oldOverrideSet)
      this.#safeTo.updateOverridesEdgeInAdded(newOverrideSet)
    }
  }

  override satisfiedBy(node: NodeClass) {
    // Patch replacing
    // if (node.name !== this.#name) {
    //   return false
    // }
    // is based on https://github.com/npm/cli/pull/7025.
    if (node.name !== this.#safeName || !this.#safeFrom) {
      return false
    }
    // NOTE: this condition means we explicitly do not support overriding
    // bundled or shrinkwrapped dependencies
    if (node.hasShrinkwrap || node.inShrinkwrap || node.inBundle) {
      return depValid(node, this.rawSpec, this.#safeAccept, this.#safeFrom)
    }
    // Patch replacing
    // return depValid(node, this.spec, this.#accept, this.#from)
    // is based on https://github.com/npm/cli/pull/7025.
    //
    // If there's no override we just use the spec.
    if (!this.overrides?.keySpec) {
      return depValid(node, this.spec, this.#safeAccept, this.#safeFrom)
    }
    // There's some override. If the target node satisfies the overriding spec
    // then it's okay.
    if (depValid(node, this.spec, this.#safeAccept, this.#safeFrom)) {
      return true
    }
    // If it doesn't, then it should at least satisfy the original spec.
    if (!depValid(node, this.rawSpec, this.#safeAccept, this.#safeFrom)) {
      return false
    }
    // It satisfies the original spec, not the overriding spec. We need to make
    // sure it doesn't use the overridden spec.
    // For example, we might have an ^8.0.0 rawSpec, and an override that makes
    // keySpec=8.23.0 and the override value spec=9.0.0.
    // If the node is 9.0.0, then it's okay because it's consistent with spec.
    // If the node is 8.24.0, then it's okay because it's consistent with the rawSpec.
    // If the node is 8.23.0, then it's not okay because even though it's consistent
    // with the rawSpec, it's also consistent with the keySpec.
    // So we're looking for ^8.0.0 or 9.0.0 and not 8.23.0.
    return !depValid(
      node,
      this.overrides.keySpec,
      this.#safeAccept,
      this.#safeFrom
    )
  }
}

// Implementation code not related to patch https://github.com/npm/cli/pull/7025
// is based on https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/node.js:
class SafeNode extends Node {
  // Return true if it's safe to remove this node, because anything that is
  // depending on it would be fine with the thing that they would resolve to if
  // it was removed, or nothing is depending on it in the first place.
  override canDedupe(preferDedupe = false) {
    // Not allowed to mess with shrinkwraps or bundles.
    if (this.inDepBundle || this.inShrinkwrap) {
      return false
    }
    // It's a top level pkg, or a dep of one.
    if (!this.resolveParent?.resolveParent) {
      return false
    }
    // No one wants it, remove it.
    if (this.edgesIn.size === 0) {
      return true
    }
    const other = this.resolveParent.resolveParent.resolve(this.name)
    // Nothing else, need this one.
    if (!other) {
      return false
    }
    // If it's the same thing, then always fine to remove.
    if (other.matches(this)) {
      return true
    }
    // If the other thing can't replace this, then skip it.
    if (!other.canReplace(this)) {
      return false
    }
    // Patch replacing
    // if (preferDedupe || semver.gte(other.version, this.version)) {
    //   return true
    // }
    // is based on https://github.com/npm/cli/pull/7025.
    //
    // If we prefer dedupe, or if the version is equal, take the other.
    if (preferDedupe || semver.eq(other.version, this.version)) {
      return true
    }
    // If our current version isn't the result of an override, then prefer to
    // take the greater version.
    if (!this.overridden && semver.gt(other.version, this.version)) {
      return true
    }
    return false
  }

  // Is it safe to replace one node with another?  check the edges to
  // make sure no one will get upset.  Note that the node might end up
  // having its own unmet dependencies, if the new node has new deps.
  // Note that there are cases where Arborist will opt to insert a node
  // into the tree even though this function returns false!  This is
  // necessary when a root dependency is added or updated, or when a
  // root dependency brings peer deps along with it.  In that case, we
  // will go ahead and create the invalid state, and then try to resolve
  // it with more tree construction, because it's a user request.
  override canReplaceWith(node: NodeClass, ignorePeers?: string[]) {
    if (this.name !== node.name || this.packageName !== node.packageName) {
      return false
    }
    // Patch replacing
    // if (node.overrides !== this.overrides) {
    //   return false
    // }
    // is based on https://github.com/npm/cli/pull/7025.
    //
    // If this node has no dependencies, then it's irrelevant to check the
    // override rules of the replacement node.
    if (this.edgesOut.size) {
      // XXX need to check for two root nodes?
      if (node.overrides) {
        if (!node.overrides.isEqual(this.overrides)) {
          return false
        }
      } else {
        if (this.overrides) {
          return false
        }
      }
    }
    // To satisfy the patch we ensure `node.overrides === this.overrides`
    // so that the condition we want to replace,
    // if (this.overrides !== node.overrides) {
    // , is not hit.`
    const oldOverrideSet = this.overrides
    let result = true
    if (oldOverrideSet !== node.overrides) {
      this.overrides = node.overrides
    }
    try {
      result = super.canReplaceWith(node, ignorePeers)
      this.overrides = oldOverrideSet
    } catch (e) {
      this.overrides = oldOverrideSet
      throw e
    }
    return result
  }

  // Patch adding deleteEdgeIn is based on https://github.com/npm/cli/pull/7025.
  override deleteEdgeIn(edge: SafeEdge) {
    this.edgesIn.delete(edge)
    const { overrides } = edge
    if (overrides) {
      this.updateOverridesEdgeInRemoved(overrides)
    }
  }

  override addEdgeIn(edge: SafeEdge): void {
    // Patch replacing
    // if (edge.overrides) {
    //   this.overrides = edge.overrides
    // }
    // is based on https://github.com/npm/cli/pull/7025.
    //
    // We need to handle the case where the new edge in has an overrides field
    // which is different from the current value.
    if (!this.overrides || !this.overrides.isEqual(edge.overrides)) {
      this.updateOverridesEdgeInAdded(edge.overrides)
    }
    this.edgesIn.add(edge)
    // Try to get metadata from the yarn.lock file.
    this.root.meta?.addEdge(edge)
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get overridden() {
    // Patch replacing
    // return !!(this.overrides && this.overrides.value && this.overrides.name === this.name)
    // is based on https://github.com/npm/cli/pull/7025.
    if (
      !this.overrides ||
      !this.overrides.value ||
      this.overrides.name !== this.name
    ) {
      return false
    }
    // The overrides rule is for a package with this name, but some override rules
    // only apply to specific versions. To make sure this package was actually
    // overridden, we check whether any edge going in had the rule applied to it,
    // in which case its overrides set is different than its source node.
    for (const edge of this.edgesIn) {
      if (
        edge.overrides &&
        edge.overrides.name === this.name &&
        edge.overrides.value === this.version
      ) {
        if (!edge.overrides?.isEqual(edge.from?.overrides)) {
          return true
        }
      }
    }
    return false
  }

  // Patch adding recalculateOutEdgesOverrides is based on
  // https://github.com/npm/cli/pull/7025.
  override recalculateOutEdgesOverrides() {
    // For each edge out propagate the new overrides through.
    for (const edge of this.edgesOut.values()) {
      edge.reload(true)
      if (edge.to) {
        edge.to.updateOverridesEdgeInAdded(edge.overrides)
      }
    }
  }

  // @ts-ignore: Incorrectly typed to accept null.
  override set root(newRoot: NodeClass) {
    // Patch removing
    // if (!this.overrides && this.parent && this.parent.overrides) {
    //   this.overrides = this.parent.overrides.getNodeRule(this)
    // }
    // is based on https://github.com/npm/cli/pull/7025.
    //
    // The "root" setter is a really large and complex function. To satisfy the
    // patch we add a dummy value to `this.overrides` so that the condition we
    // want to remove,
    // if (!this.overrides && this.parent && this.parent.overrides) {
    // , is not hit.
    if (!this.overrides) {
      this.overrides = new OverrideSet({ overrides: '' })
    }
    try {
      super.root = newRoot
      this.overrides = undefined
    } catch (e) {
      this.overrides = undefined
      throw e
    }
  }

  // Patch adding updateOverridesEdgeInAdded is based on
  // https://github.com/npm/cli/pull/7025.
  //
  // This logic isn't perfect either. When we have two edges in that have
  // different override sets, then we have to decide which set is correct. This
  // function assumes the more specific override set is applicable, so if we have
  // dependencies A->B->C and A->C and an override set that specifies what happens
  // for C under A->B, this will work even if the new A->C edge comes along and
  // tries to change the override set. The strictly correct logic is not to allow
  // two edges with different overrides to point to the same node, because even
  // if this node can satisfy both, one of its dependencies might need to be
  // different depending on the edge leading to it. However, this might cause a
  // lot of duplication, because the conflict in the dependencies might never
  // actually happen.
  override updateOverridesEdgeInAdded(
    otherOverrideSet: OverrideSetClass | undefined
  ) {
    if (!otherOverrideSet) {
      // Assuming there are any overrides at all, the overrides field is never
      // undefined for any node at the end state of the tree. So if the new edge's
      // overrides is undefined it will be updated later. So we can wait with
      // updating the node's overrides field.
      return false
    }
    if (!this.overrides) {
      this.overrides = otherOverrideSet
      this.recalculateOutEdgesOverrides()
      return true
    }
    if (this.overrides.isEqual(otherOverrideSet)) {
      return false
    }
    const newOverrideSet = findSpecificOverrideSet(
      this.overrides,
      otherOverrideSet
    )
    if (newOverrideSet) {
      if (this.overrides.isEqual(newOverrideSet)) {
        return false
      }
      this.overrides = newOverrideSet
      this.recalculateOutEdgesOverrides()
      return true
    }
    // This is an error condition. We can only get here if the new override set
    // is in conflict with the existing.
    log?.silly('Conflicting override sets', this.name)
    return false
  }

  // Patch adding updateOverridesEdgeInRemoved is based on
  // https://github.com/npm/cli/pull/7025.
  override updateOverridesEdgeInRemoved(otherOverrideSet: OverrideSetClass) {
    // If this edge's overrides isn't equal to this node's overrides,
    // then removing it won't change newOverrideSet later.
    if (!this.overrides || !this.overrides.isEqual(otherOverrideSet)) {
      return false
    }
    let newOverrideSet
    for (const edge of this.edgesIn) {
      const { overrides: edgeOverrides } = edge
      if (newOverrideSet && edgeOverrides) {
        newOverrideSet = findSpecificOverrideSet(edgeOverrides, newOverrideSet)
      } else {
        newOverrideSet = edgeOverrides
      }
    }
    if (this.overrides.isEqual(newOverrideSet)) {
      return false
    }
    this.overrides = newOverrideSet
    if (newOverrideSet) {
      // Optimization: If there's any override set at all, then no non-extraneous
      // node has an empty override set. So if we temporarily have no override set
      // (for example, we removed all the edges in), there's no use updating all
      // the edges out right now. Let's just wait until we have an actual override
      // set later.
      this.recalculateOutEdgesOverrides()
    }
    return true
  }
}

// Implementation code not related to patch https://github.com/npm/cli/pull/7025
// is based on https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/override-set.js:
class SafeOverrideSet extends OverrideSet {
  // Patch adding childrenAreEqual is based on
  // https://github.com/npm/cli/pull/7025.
  override childrenAreEqual(otherOverrideSet: OverrideSetClass): boolean {
    const queue: [OverrideSetClass, OverrideSetClass][] = [
      [this, otherOverrideSet]
    ]
    let pos = 0
    let { length: queueLength } = queue
    while (pos < queueLength) {
      if (pos === LOOP_SENTINEL) {
        throw new Error('Detected infinite loop while comparing override sets')
      }
      const { 0: currSet, 1: currOtherSet } = queue[pos++]!
      const { children } = currSet
      const { children: otherChildren } = currOtherSet
      if (children.size !== otherChildren.size) {
        return false
      }
      for (const key of children.keys()) {
        if (!otherChildren.has(key)) {
          return false
        }
        const child = children.get(key)!
        const otherChild = otherChildren.get(key)!
        if (child.value !== otherChild.value) {
          return false
        }
        queue[queueLength++] = [child, otherChild]
      }
    }
    return true
  }

  override getEdgeRule(edge: SafeEdge): OverrideSetClass {
    for (const rule of this.ruleset.values()) {
      if (rule.name !== edge.name) {
        continue
      }
      // If keySpec is * we found our override.
      if (rule.keySpec === '*') {
        return rule
      }
      // Patch replacing
      // let spec = npa(`${edge.name}@${edge.spec}`)
      // is based on https://github.com/npm/cli/pull/7025.
      //
      // We need to use the rawSpec here, because the spec has the overrides
      // applied to it already.
      let spec = npa(`${edge.name}@${edge.rawSpec}`)
      if (spec.type === 'alias') {
        spec = (<AliasResult>spec).subSpec
      }
      if (spec.type === 'git') {
        if (
          spec.gitRange &&
          rule.keySpec &&
          semver.intersects(spec.gitRange, rule.keySpec)
        ) {
          return rule
        }
        continue
      }
      if (spec.type === 'range' || spec.type === 'version') {
        if (
          rule.keySpec &&
          semver.intersects((<RegistryResult>spec).fetchSpec, rule.keySpec)
        ) {
          return rule
        }
        continue
      }
      // If we got this far, the spec type is one of tag, directory or file
      // which means we have no real way to make version comparisons, so we
      // just accept the override.
      return rule
    }
    return this
  }

  // Patch adding isEqual is based on
  // https://github.com/npm/cli/pull/7025.
  override isEqual(otherOverrideSet: OverrideSetClass | undefined) {
    if (this === otherOverrideSet) {
      return true
    }
    if (!otherOverrideSet) {
      return false
    }
    if (
      this.key !== otherOverrideSet.key ||
      this.value !== otherOverrideSet.value
    ) {
      return false
    }
    if (!this.childrenAreEqual(otherOverrideSet)) {
      return false
    }
    if (!this.parent) {
      return !otherOverrideSet.parent
    }
    return this.parent.isEqual(otherOverrideSet.parent)
  }
}

// Implementation code not related to our custom behavior is based on
// https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/arborist/index.js:
export class SafeArborist extends Arborist {
  constructor(...ctorArgs: ConstructorParameters<ArboristClass>) {
    const mutedArguments = [
      {
        ...ctorArgs[0],
        audit: true,
        dryRun: true,
        ignoreScripts: true,
        save: false,
        saveBundle: false,
        // progress: false,
        fund: false
      },
      ctorArgs.slice(1)
    ]
    super(...mutedArguments)
    ;(this as any)[kCtorArgs] = ctorArgs
  }

  async [kRiskyReify](
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<NodeClass> {
    // SafeArborist has suffered side effects and must be rebuilt from scratch.
    const arb = new Arborist(...(this as any)[kCtorArgs])
    arb.idealTree = this.idealTree
    const ret = <unknown>await arb.reify(...args)
    Object.assign(this, arb)
    return <NodeClass>ret
  }

  // @ts-ignore Incorrectly typed.
  override async reify(
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<NodeClass> {
    const options = <ArboristOptions>(args[0] ? { ...args[0] } : {})
    if (options.dryRun) {
      return await this[kRiskyReify](...args)
    }
    const old = {
      ...options,
      dryRun: false,
      save: Boolean(options['save'] ?? true),
      saveBundle: Boolean(options['saveBundle'] ?? false)
    }
    args[0] = options
    options.dryRun = true
    options['save'] = false
    options['saveBundle'] = false
    // TODO: Make this deal with any refactor to private fields by punching the
    // class itself.
    await super.reify(...args)
    options.dryRun = old.dryRun
    options['save'] = old.save
    options['saveBundle'] = old.saveBundle
    const needInfoOn = walk(this['diff']!)
    if (
      needInfoOn.findIndex(c => c.repository_url === NPM_REGISTRY_URL) === -1
    ) {
      // Nothing to check, hmmm already installed or all private?
      return await this[kRiskyReify](...args)
    }
    const input = process.stdin
    const output = process.stderr
    let alerts: SocketPackageAlert[] | undefined
    const proceed =
      ENV[SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE] ||
      (await (async () => {
        alerts = await getPackagesAlerts(this, needInfoOn, output)
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
        await updateAdvisoryDependencies(this, alerts!)
      }
      return await this[kRiskyReify](...args)
    } else {
      throw new Error('Socket npm exiting due to risks')
    }
  }
}

async function updateAdvisoryDependencies(
  arb: ArboristInstance | SafeArborist,
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

function findPackageRecursively(
  tree: BaseNode | NodeClass | LinkNode,
  packageName: string
): NodeClass | null {
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
      return (<unknown>node) as NodeClass
    }
    const children = [...currentNode.children.values()]
    for (let i = children.length - 1; i >= 0; i -= 1) {
      queue.push({ node: children[i]! })
    }
  }
  return null
}

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

export function installSafeArborist() {
  const cache: { [key: string]: any } = require.cache
  cache[arboristClassPath] = { exports: SafeArborist }
  cache[arboristEdgeClassPath] = { exports: SafeEdge }
  cache[arboristNodeClassPath] = { exports: SafeNode }
  cache[arboristOverrideSetClassPatch] = { exports: SafeOverrideSet }
}

void (async () => {
  const { orgs, settings } = await (async () => {
    try {
      const socketSdk = await setupSdk(pubToken)
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
      if (isObject(e) && 'cause' in e) {
        const { cause } = e
        if (isErrnoException(cause)) {
          if (cause.code === 'ENOTFOUND' || cause.code === 'ECONNREFUSED') {
            throw new Error(
              'Unable to connect to socket.dev, ensure internet connectivity before retrying',
              {
                cause: e
              }
            )
          }
        }
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
