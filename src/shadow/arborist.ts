import events from 'node:events'
import { readFileSync, realpathSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import rl from 'node:readline'
import { PassThrough } from 'node:stream'
import { setTimeout as wait } from 'node:timers/promises'

import config from '@socketsecurity/config'
import chalk from 'chalk'
import isInteractive from 'is-interactive'
import ora, { spinners } from 'ora'

import { createTTYServer } from './tty-server'
import { ChalkOrMarkdown } from '../utils/chalk-markdown'
import { createIssueUXLookup } from '../utils/issue-rules'
import { isErrnoException } from '../utils/misc'
import { findRoot } from '../utils/path-resolve'
import { getDefaultKey, FREE_API_KEY, setupSdk } from '../utils/sdk'
import { getSetting } from '../utils/settings'

import type {
  Arborist as BaseArborist,
  DependencyProblem,
  Diff,
  Edge as BaseEdge,
  Node as BaseNode,
  Options as ArboristOptions
} from '@npmcli/arborist'
import type { Writable } from 'node:stream'
import type { Options as OraOptions } from 'ora'
import { API_V0_URL, ENV } from '../constants'

type ArboristClass = typeof BaseArborist & {
  new (...args: any): typeof BaseArborist
}

type EdgeClass = Omit<BaseEdge, 'overrides' | 'reload'> & {
  optional: boolean
  overrides: OverrideSet | undefined
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
  overrides?: OverrideSet | undefined
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
  action: Diff['action']
  existing: NodeClass['pkgid'] | null
  pkgid: NodeClass['pkgid']
  resolved: NodeClass['resolved']
  location: NodeClass['location']
  oldPackage: PURLParts | null
  newPackage: PURLParts
}

type NodeClass = Omit<BaseNode, 'edgesOut' | 'isTop' | 'parent' | 'resolve'> & {
  name: string
  version: string
  edgesIn: Set<SafeEdge>
  edgesOut: Map<string, SafeEdge>
  hasShrinkwrap: boolean
  inShrinkwrap: boolean | undefined
  isTop: boolean | undefined
  overrides: OverrideSet | undefined
  parent: NodeClass | null
  new (...args: any): NodeClass
  addEdgeIn(edge: SafeEdge): void
  addEdgeOut(edge: SafeEdge): void
  resolve(name: string): NodeClass
}

interface OverrideSet {
  children: Map<string, OverrideSet>
  key: string | undefined
  keySpec: string | undefined
  name: string | undefined
  parent: OverrideSet | undefined
  value: string | undefined
  version: string | undefined
  get isRoot(): boolean
  get ruleset(): Map<string, OverrideSet>
  ancestry(): Generator<OverrideSet>
  getEdgeRule(edge: SafeEdge): OverrideSet
  getNodeRule(node: NodeClass): OverrideSet
  getMatchingRule(node: NodeClass): OverrideSet | null
}

type PURLParts = {
  type: 'npm'
  namespace_and_name: string
  version: string
  repository_url: URL['href']
}

const LOOP_SENTINEL = 1_000_000

const POTENTIALLY_BUG_ERROR_SNIPPET =
  'this is potentially a bug with socket-npm caused by changes to the npm cli'

const distPath = __dirname
const rootPath = path.resolve(distPath, '..')

const translations = require(path.join(rootPath, 'translations.json'))

const npmEntrypoint = realpathSync(`${process.argv[1]}`)
const npmRootPath = findRoot(path.dirname(npmEntrypoint))

const abortController = new AbortController()
const { signal: abortSignal } = abortController

if (npmRootPath === undefined) {
  console.error(
    `Unable to find npm cli install directory, ${POTENTIALLY_BUG_ERROR_SNIPPET}.`
  )
  console.error(`Searched parent directories of ${npmEntrypoint}`)
  process.exit(127)
}

const npmNmPath = path.join(npmRootPath, 'node_modules')
const arboristClassPath = path.join(
  npmNmPath,
  '@npmcli/arborist/lib/arborist/index.js'
)
const arboristEdgeClassPath = path.join(
  npmNmPath,
  '@npmcli/arborist/lib/edge.js'
)

let npmlog: typeof import('npmlog') | undefined
try {
  npmlog = require(path.join(npmNmPath, 'proc-log/lib/index.js')).log
} catch {}
if (npmlog === undefined) {
  try {
    npmlog = require(path.join(npmNmPath, 'npmlog/lib/log.js'))
  } catch {}
}
if (npmlog === undefined) {
  console.error(
    `Unable to integrate with npm cli logging infrastructure, ${POTENTIALLY_BUG_ERROR_SNIPPET}.`
  )
  process.exit(127)
}

let tarball: typeof import('pacote').tarball
try {
  tarball = require(path.join(npmNmPath, 'pacote')).tarball
} catch {
  tarball = require('pacote').tarball
}

const Arborist: ArboristClass = require(arboristClassPath)
const Edge: EdgeClass = require(arboristEdgeClassPath)

const kCtorArgs = Symbol('ctorArgs')
const kRiskyReify = Symbol('riskyReify')

const formatter = new ChalkOrMarkdown(false)
const pubToken = getDefaultKey() ?? FREE_API_KEY

type IssueUXLookup = ReturnType<typeof createIssueUXLookup>
type IssueUXLookupSettings = Parameters<IssueUXLookup>[0]
type IssueUXLookupResult = ReturnType<IssueUXLookup>

const ttyServer = createTTYServer(
  chalk.level,
  isInteractive({ stream: process.stdin }),
  npmlog
)

let _uxLookup: IssueUXLookup | undefined

async function uxLookup(
  settings: IssueUXLookupSettings
): Promise<IssueUXLookupResult> {
  while (_uxLookup === undefined) {
    await wait(1, { signal: abortSignal })
  }
  return _uxLookup(settings)
}

async function* batchScan(
  pkgIds: string[]
): AsyncGenerator<
  { eco: string; pkg: string; ver: string } & (
    | { type: 'missing' }
    | { type: 'success'; value: { issues: any[] } }
  )
> {
  const query = {
    packages: pkgIds.map(pkgid => {
      const { name, version } = pkgidParts(pkgid)
      return {
        eco: 'npm',
        pkg: name,
        ver: version,
        top: true
      }
    })
  }
  // TODO: Migrate to SDK.
  const pkgDataReq = https
    .request(`${API_V0_URL}/scan/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${pubToken}:`).toString('base64url')}`
      },
      signal: abortSignal
    })
    .end(JSON.stringify(query))
  const { 0: res } = await events.once(pkgDataReq, 'response')
  const ok = res.statusCode >= 200 && res.statusCode <= 299
  if (!ok) {
    throw new Error(`Socket API Error: ${res.statusCode}`)
  }
  const rli = rl.createInterface(res)
  for await (const line of rli) {
    yield JSON.parse(line)
  }
}

function deleteEdgeIn(node: NodeClass, edge: SafeEdge) {
  node.edgesIn.delete(edge)
  const { overrides } = edge
  if (overrides) {
    updateNodeOverrideSetDueToEdgeRemoval(node, overrides)
  }
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

function findSpecificOverrideSet(
  first: OverrideSet | undefined,
  second: OverrideSet | undefined
) {
  let overrideSet = second
  while (overrideSet) {
    if (overrideSetsEqual(overrideSet, first)) {
      return second
    }
    overrideSet = overrideSet.parent
  }
  overrideSet = first
  while (overrideSet) {
    if (overrideSetsEqual(overrideSet, second)) {
      return first
    }
    overrideSet = overrideSet.parent
  }
  console.error('Conflicting override sets')
  return undefined
}

function maybeReadfileSync(filepath: string): string | undefined {
  try {
    return readFileSync(filepath, 'utf8')
  } catch {}
  return undefined
}

function overrideSetsChildrenAreEqual(
  overrideSet: OverrideSet,
  other: OverrideSet
): boolean {
  const queue: [OverrideSet, OverrideSet][] = [[overrideSet, other]]
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
      const child = <OverrideSet>children.get(key)
      const otherChild = <OverrideSet>otherChildren.get(key)
      if (child!.value !== otherChild!.value) {
        return false
      }
      queue[queueLength++] = [child, otherChild]
    }
  }
  return true
}

function overrideSetsEqual(
  overrideSet: OverrideSet,
  other: OverrideSet | undefined
) {
  if (overrideSet === other) {
    return true
  }
  if (!other) {
    return false
  }
  if (overrideSet.key !== other.key || overrideSet.value !== other.value) {
    return false
  }
  if (!overrideSetsChildrenAreEqual(overrideSet, other)) {
    return false
  }
  if (!overrideSet.parent) {
    return !other.parent
  }
  return overrideSetsEqual(overrideSet.parent, other.parent)
}

async function packagesHaveRiskyIssues(
  safeArb: SafeArborist,
  _registry: string,
  pkgs: InstallEffect[],
  output?: Writable
): Promise<boolean> {
  let result = false
  let remaining = pkgs.length
  if (!remaining) {
    ora('').succeed('No changes detected')
    return result
  }

  const getText = () => `Looking up data for ${remaining} packages`

  const spinner = ora({
    color: 'cyan',
    stream: output,
    isEnabled: true,
    isSilent: false,
    hideCursor: true,
    discardStdin: true,
    spinner: spinners.dots
  } as OraOptions).start(getText())

  try {
    for await (const pkgData of batchScan(pkgs.map(pkg => pkg.pkgid))) {
      let failures: { block?: boolean; raw?: any; type?: string }[] = []
      let displayWarning = false

      const name = pkgData.pkg
      const version = pkgData.ver
      const id = `${name}@${version}`

      if (pkgData.type === 'missing') {
        result = true
        failures.push({
          type: 'missingDependency'
        })
      } else {
        let blocked = false
        for (const failure of pkgData.value.issues) {
          const ux = await uxLookup({
            package: { name, version },
            issue: { type: failure.type }
          })
          if (ux.display || ux.block) {
            failures.push({ raw: failure, block: ux.block })
            // Before we ask about problematic issues, check to see if they
            // already existed in the old version if they did, be quiet.
            const pkg = pkgs.find(
              pkg => pkg.pkgid === id && pkg.existing?.startsWith(`${name}@`)
            )
            if (pkg?.existing) {
              for await (const oldPkgData of batchScan([pkg.existing])) {
                if (oldPkgData.type === 'success') {
                  failures = failures.filter(
                    issue =>
                      oldPkgData.value.issues.find(
                        oldIssue => oldIssue.type === issue.raw.type
                      ) == null
                  )
                }
              }
            }
          }
          if (ux.block) {
            result = true
            blocked = true
          }
          if (ux.display) {
            displayWarning = true
          }
        }
        if (!blocked) {
          const pkg = pkgs.find(pkg => pkg.pkgid === id)
          if (pkg) {
            await tarball.stream(
              id,
              stream => {
                stream.resume()
                return (stream as any).promise()
              },
              { ...(safeArb as any)[kCtorArgs][0] }
            )
          }
        }
      }
      if (displayWarning) {
        spinner.stop()
        output?.write(
          `(socket) ${formatter.hyperlink(id, `https://socket.dev/npm/package/${name}/overview/${version}`)} contains risks:\n`
        )
        failures.sort((a, b) => (a.raw.type < b.raw.type ? -1 : 1))
        const lines = new Set()
        for (const failure of failures) {
          const type = failure.raw.type
          if (type) {
            const issueTypeTranslation = translations.issues[type]
            // TODO: emoji seems to mis-align terminals sometimes
            lines.add(
              `  ${issueTypeTranslation?.title ?? type}${failure.block ? '' : ' (non-blocking)'} - ${issueTypeTranslation?.description ?? ''}\n`
            )
          }
        }
        for (const line of lines) {
          output?.write(line)
        }
        spinner.start()
      }
      remaining -= 1
      spinner.text = remaining > 0 ? getText() : ''
    }
    return result
  } finally {
    if (spinner.isSpinning) {
      spinner.stop()
    }
  }
}

function pkgidParts(pkgid: string) {
  const delimiter = pkgid.lastIndexOf('@')
  const name = pkgid.slice(0, delimiter)
  const version = pkgid.slice(delimiter + 1)
  return { name, version }
}

function recalculateOutEdgesOverrides(node: NodeClass) {
  // For each edge out propagate the new overrides through.
  for (const edge of node.edgesOut.values()) {
    edge.reload(true)
    if (edge.to) {
      updateNodeOverrideSet(edge.to, edge.overrides)
    }
  }
}

function toPURL(pkgid: string, resolved: string): PURLParts {
  const repo = resolved
    .replace(/#[\s\S]*$/u, '')
    .replace(/\?[\s\S]*$/u, '')
    .replace(/\/[^/]*\/-\/[\s\S]*$/u, '')
  const { name, version } = pkgidParts(pkgid)
  return {
    type: 'npm',
    namespace_and_name: name,
    version,
    repository_url: repo
  }
}

function updateNodeOverrideSetDueToEdgeRemoval(
  node: NodeClass,
  other: OverrideSet
) {
  const { overrides } = node
  // If this edge's overrides isn't equal to this node's overrides, then removing
  // it won't change newOverrideSet later.
  if (!overrides || !overrideSetsEqual(overrides, other)) {
    return false
  }
  let newOverrideSet
  for (const edge of node.edgesIn) {
    const { overrides: edgeOverrides } = edge
    if (newOverrideSet) {
      newOverrideSet = findSpecificOverrideSet(edgeOverrides, newOverrideSet)
    } else {
      newOverrideSet = edgeOverrides
    }
  }
  if (overrideSetsEqual(overrides, newOverrideSet)) {
    return false
  }
  node.overrides = newOverrideSet
  if (newOverrideSet) {
    // Optimization: If there's any override set at all, then no non-extraneous
    // node has an empty override set. So if we temporarily have no override set
    // (for example, we removed all the edges in), there's no use updating all
    // the edges out right now. Let's just wait until we have an actual override
    // set later.
    recalculateOutEdgesOverrides(node)
  }
  return true
}

// This logic isn't perfect either. When we have two edges in that have different
// override sets, then we have to decide which set is correct. This function
// assumes the more specific override set is applicable, so if we have dependencies
// A->B->C and A->C and an override set that specifies what happens for C under
// A->B, this will work even if the new A->C edge comes along and tries to change
// the override set. The strictly correct logic is not to allow two edges with
// different overrides to point to the same node, because even if this node can
// satisfy both, one of its dependencies might need to be different depending on
// the edge leading to it. However, this might cause a lot of duplication, because
// the conflict in the dependencies might never actually happen.
function updateNodeOverrideSet(
  node: NodeClass,
  otherOverrideSet: OverrideSet | undefined
) {
  if (!node.overrides) {
    // Assuming there are any overrides at all, the overrides field is never
    // undefined for any node at the end state of the tree. So if the new edge's
    // overrides is undefined it will be updated later. So we can wait with
    // updating the node's overrides field.
    if (!otherOverrideSet) {
      return false
    }
    node.overrides = otherOverrideSet
    recalculateOutEdgesOverrides(node)
    return true
  }
  const { overrides } = node
  if (overrideSetsEqual(overrides, otherOverrideSet)) {
    return false
  }
  const newOverrideSet = findSpecificOverrideSet(overrides, otherOverrideSet)
  if (newOverrideSet) {
    if (overrideSetsEqual(overrides, newOverrideSet)) {
      return false
    }
    node.overrides = newOverrideSet
    recalculateOutEdgesOverrides(node)
    return true
  }
  // This is an error condition. We can only get here if the new override set is
  // in conflict with the existing.
  console.error('Conflicting override sets')
  return false
}

function walk(
  diff_: Diff | null,
  needInfoOn: InstallEffect[] = []
): InstallEffect[] {
  const queue: (Diff | null)[] = [diff_]
  let pos = 0
  let { length: queueLength } = queue
  while (pos < queueLength) {
    if (pos === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop while walking Arborist diff')
    }
    const diff = queue[pos++]!
    if (!diff) {
      continue
    }
    if (diff.action) {
      const sameVersion =
        diff.actual?.package.version === diff.ideal?.package.version
      let keep = false
      let existing = null
      if (diff.action === 'CHANGE') {
        if (!sameVersion) {
          existing = diff.actual.pkgid
          keep = true
        } else {
          // console.log('SKIPPING META CHANGE ON', diff)
        }
      } else {
        keep = diff.action !== 'REMOVE'
      }
      if (
        keep &&
        diff.ideal?.pkgid &&
        diff.ideal.resolved &&
        (!diff.actual || diff.actual.resolved)
      ) {
        needInfoOn.push({
          existing,
          action: diff.action,
          location: diff.ideal.location,
          pkgid: diff.ideal.pkgid,
          newPackage: toPURL(diff.ideal.pkgid, diff.ideal.resolved),
          oldPackage:
            diff.actual && diff.actual.resolved
              ? toPURL(diff.actual.pkgid, diff.actual.resolved)
              : null,
          resolved: diff.ideal.resolved
        })
      }
    }
    if (diff.children) {
      for (const child of diff.children) {
        queue[queueLength++] = child
      }
    }
  }
  return needInfoOn
}

// Copied from
// https://github.com/npm/cli/blob/v10.9.0/workspaces/arborist/lib/edge.js:
// The npm application
// Copyright (c) npm, Inc. and Contributors
// Licensed on the terms of The Artistic License 2.0
//
// An edge in the dependency graph.
// Represents a dependency relationship of some kind.

class SafeEdge extends Edge {
  #safeAccept: string | undefined
  #safeError: ErrorStatus | null
  #safeExplanation: Explanation | undefined
  #safeFrom: NodeClass | null
  #safeTo: NodeClass | null

  constructor(options: EdgeOptions) {
    const { accept, from } = options
    // Defer to supper to validate options and assign non-private values.
    super(options)
    if (accept !== undefined) {
      this.#safeAccept = accept || '*'
    }
    this.#safeError = null
    this.#safeExplanation = null
    this.#safeFrom = from
    this.#safeTo = null
    this.reload(true)
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

  get bundled() {
    return !!this.#safeFrom?.package?.bundleDependencies?.includes(this.name)
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get spec(): string {
    if (
      this.overrides?.value &&
      this.overrides.value !== '*' &&
      this.overrides.name === this.name
    ) {
      if (this.overrides.value.startsWith('$')) {
        const ref = this.overrides.value.slice(1)
        // We may be a virtual root, if we are we want to resolve reference
        // overrides from the real root, not the virtual one.
        const pkg = this.#safeFrom?.sourceReference
          ? this.#safeFrom.sourceReference.root.package
          : this.#safeFrom?.root.package
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

  get accept() {
    return this.#safeAccept
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
      } else {
        this.#safeError = 'OK'
      }
    }
    if (this.#safeError === 'OK') {
      return null
    }
    return this.#safeError
  }

  override reload(hard = false) {
    this.#safeExplanation = null
    if (this.#safeFrom?.overrides) {
      this.overrides = this.#safeFrom.overrides.getEdgeRule(this)
    } else {
      this.overrides = undefined
    }
    const newTo = this.#safeFrom?.resolve(this.name)
    if (newTo !== this.#safeTo) {
      if (this.#safeTo) {
        // Instead of `this.#safeTo.edgesIn.delete(this)` we patch based on
        // https://github.com/npm/cli/pull/7025.
        deleteEdgeIn(this.#safeTo, this)
      }
      this.#safeTo = <NodeClass>newTo ?? null
      this.#safeError = null
      if (this.#safeTo) {
        this.#safeTo.addEdgeIn(this)
      }
    } else if (hard) {
      this.#safeError = null
    }
  }

  detach() {
    this.#safeExplanation = null
    if (this.#safeTo) {
      // Instead of `this.#safeTo.edgesIn.delete(this)` we patch based on
      // https://github.com/npm/cli/pull/7025.
      deleteEdgeIn(this.#safeTo, this)
    }
    if (this.#safeFrom) {
      this.#safeFrom.edgesOut.delete(this.name)
    }
    this.#safeTo = null
    this.#safeError = 'DETACHED'
    this.#safeFrom = null
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get from() {
    return this.#safeFrom
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get to() {
    return this.#safeTo
  }
}

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
    const ret = <unknown>await arb.reify(...args)
    Object.assign(this, arb)
    return <NodeClass>ret
  }

  // @ts-ignore Incorrectly typed.
  override async reify(
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<NodeClass> {
    const options = args[0] ? <ArboristOptions>{ ...args[0] } : {}
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
    // TODO: Make this deal w/ any refactor to private fields by punching the
    // class itself.
    await super.reify(...args)
    const diff = walk(this['diff'])
    options.dryRun = old.dryRun
    options['save'] = old.save
    options['saveBundle'] = old.saveBundle
    // Nothing to check, mmm already installed or all private?
    if (
      diff.findIndex(
        c => c.newPackage.repository_url === 'https://registry.npmjs.org'
      ) === -1
    ) {
      return await this[kRiskyReify](...args)
    }
    let proceed = ENV.UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE
    if (!proceed) {
      proceed = await ttyServer.captureTTY(
        async (colorLevel, input, output) => {
          chalk.level = colorLevel
          if (input && output) {
            const risky = await packagesHaveRiskyIssues(
              this,
              this['registry'],
              diff,
              output
            )
            if (!risky) {
              return true
            }
            const rlin = new PassThrough()
            input.pipe(rlin)
            const rlout = new PassThrough()
            rlout.pipe(output, { end: false })
            const rli = rl.createInterface(rlin, rlout)
            try {
              while (true) {
                const answer: string = await new Promise(resolve => {
                  rli.question(
                    'Accept risks of installing these packages (y/N)?\n',
                    { signal: abortSignal },
                    resolve
                  )
                })
                if (/^\s*y(?:es)?\s*$/i.test(answer)) {
                  return true
                }
                if (/^(?:\s*no?\s*|)$/i.test(answer)) {
                  return false
                }
              }
            } finally {
              rli.close()
            }
          } else if (
            await packagesHaveRiskyIssues(this, this['registry'], diff, output)
          ) {
            throw new Error(
              'Socket npm Unable to prompt to accept risk, need TTY to do so'
            )
          }
          return true
        }
      )
    }
    if (proceed) {
      return await this[kRiskyReify](...args)
    } else {
      throw new Error('Socket npm exiting due to risks')
    }
  }
}

export function installSafeArborist() {
  require.cache[arboristEdgeClassPath]!.exports = SafeEdge
  require.cache[arboristClassPath]!.exports = SafeArborist
}

void (async () => {
  const remoteSettings = await (async () => {
    try {
      const socketSdk = await setupSdk(pubToken)
      const orgResult = await socketSdk.getOrganizations()
      if (!orgResult.success) {
        throw new Error(
          'Failed to fetch Socket organization info: ' + orgResult.error.message
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
        orgs.map(org => {
          return {
            organization: org.id
          }
        })
      )
      if (!result.success) {
        throw new Error(
          'Failed to fetch API key settings: ' + result.error.message
        )
      }
      return {
        orgs,
        settings: result.data
      }
    } catch (e: any) {
      if (typeof e === 'object' && e !== null && 'cause' in e) {
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
  const { orgs, settings } = remoteSettings
  const enforcedOrgs = getSetting('enforcedOrgs') ?? []

  // remove any organizations not being enforced
  for (const { 0: i, 1: org } of orgs.entries()) {
    if (!enforcedOrgs.includes(org.id)) {
      settings.entries.splice(i, 1)
    }
  }

  const socketYml = findSocketYmlSync()
  if (socketYml) {
    settings.entries.push({
      start: socketYml.path,
      // @ts-ignore
      settings: {
        [socketYml.path]: {
          deferTo: null,
          issueRules: socketYml.parsed.issueRules
        }
      }
    })
  }
  _uxLookup = createIssueUXLookup(settings)
})()
