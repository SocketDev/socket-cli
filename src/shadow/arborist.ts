import events from 'node:events'
import { readFileSync, realpathSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import rl from 'node:readline'
import { PassThrough } from 'node:stream'
import { setTimeout as wait } from 'node:timers/promises'

import chalk from 'chalk'
import isInteractive from 'is-interactive'
import npa from 'npm-package-arg'
import ora, { spinners } from 'ora'
import semver from 'semver'

import config from '@socketsecurity/config'
import { isObject } from '@socketsecurity/registry/lib/objects'

import { createTTYServer } from './tty-server'
import { API_V0_URL, ENV } from '../constants'
import { ChalkOrMarkdown } from '../utils/chalk-markdown'
import { createIssueUXLookup } from '../utils/issue-rules'
import { isErrnoException } from '../utils/misc'
import { findRoot } from '../utils/path-resolve'
import { FREE_API_KEY, getDefaultKey, setupSdk } from '../utils/sdk'
import { getSetting } from '../utils/settings'

import type {
  Options as ArboristOptions,
  Arborist as BaseArborist,
  Edge as BaseEdge,
  Node as BaseNode,
  DependencyProblem,
  Diff
} from '@npmcli/arborist'
import type { Writable } from 'node:stream'
import type { AliasResult, RegistryResult } from 'npm-package-arg'
import type { Options as OraOptions } from 'ora'

type ArboristClass = typeof BaseArborist & {
  new (...args: any): typeof BaseArborist
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

type NodeClass = Omit<
  BaseNode,
  'edgesIn' | 'edgesOut' | 'from' | 'isTop' | 'parent' | 'resolve' | 'root'
> & {
  name: string
  version: string
  edgesIn: Set<SafeEdge>
  edgesOut: Map<string, SafeEdge>
  from: NodeClass | null
  hasShrinkwrap: boolean
  inShrinkwrap: boolean | undefined
  isTop: boolean | undefined
  meta: BaseNode['meta'] & {
    addEdge(edge: SafeEdge): void
  }
  overrides: OverrideSetClass | undefined
  parent: NodeClass | null
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

interface KnownModules {
  npmlog: typeof import('npmlog')
  pacote: typeof import('pacote')
  'proc-log': typeof import('proc-log')
}

type PURLParts = {
  type: 'npm'
  namespace_and_name: string
  version: string
  repository_url: URL['href']
}

type RequireTransformer<T extends keyof KnownModules> = (
  mod: KnownModules[T]
) => KnownModules[T]

const POTENTIALLY_BUG_ERROR_SNIPPET =
  'this is potentially a bug with socket-npm caused by changes to the npm cli'

const distPath = __dirname
const rootPath = path.resolve(distPath, '..')

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
    `Unable to find npm cli install directory, ${POTENTIALLY_BUG_ERROR_SNIPPET}.`
  )
  console.error(`Searched parent directories of ${npmEntrypoint}`)
  process.exit(127)
}

const LOOP_SENTINEL = 1_000_000
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'

const npmNmPath = path.join(npmRootPath, 'node_modules')

const arboristClassPath = path.join(
  npmNmPath,
  '@npmcli/arborist/lib/arborist/index.js'
)
const arboristDepValidPath = path.join(
  npmNmPath,
  '@npmcli/arborist/lib/dep-valid.js'
)
const arboristEdgeClassPath = path.join(
  npmNmPath,
  '@npmcli/arborist/lib/edge.js'
)
const arboristNodeClassPath = path.join(
  npmNmPath,
  '@npmcli/arborist/lib/node.js'
)
const arboristOverrideSetClassPatch = path.join(
  npmNmPath,
  '@npmcli/arborist/lib/override-set.js'
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

if (log === undefined) {
  console.error(
    `Unable to integrate with npm cli logging infrastructure, ${POTENTIALLY_BUG_ERROR_SNIPPET}.`
  )
  process.exit(127)
}

const pacote = tryRequire(<'pacote'>path.join(npmNmPath, 'pacote'), 'pacote')!
const { tarball } = pacote
const translations = require(path.join(rootPath, 'translations.json'))

const abortController = new AbortController()
const { signal: abortSignal } = abortController

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

const formatter = new ChalkOrMarkdown(false)
const pubToken = getDefaultKey() ?? FREE_API_KEY

type IssueUXLookup = ReturnType<typeof createIssueUXLookup>
type IssueUXLookupSettings = Parameters<IssueUXLookup>[0]
type IssueUXLookupResult = ReturnType<IssueUXLookup>

const ttyServer = createTTYServer(
  chalk.level,
  isInteractive({ stream: process.stdin }),
  log
)

let _uxLookup: IssueUXLookup | undefined

async function uxLookup(
  settings: IssueUXLookupSettings
): Promise<IssueUXLookupResult> {
  while (_uxLookup === undefined) {
    // eslint-disable-next-line no-await-in-loop
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
  log!.silly('Conflicting override sets', first, second)
  return undefined
}

function maybeReadfileSync(filepath: string): string | undefined {
  try {
    return readFileSync(filepath, 'utf8')
  } catch {}
  return undefined
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
          // eslint-disable-next-line no-await-in-loop
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
              // eslint-disable-next-line no-await-in-loop
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

// The Edge class makes heavy use of private properties which subclasses do NOT
// have access to. So we have to recreate any functionality that relies on those
// private properties and use our own "safe" prefixed non-conflicting private
// properties. Implementation code not related to patch https://github.com/npm/cli/pull/7025
// is based on https://github.com/npm/cli/blob/v10.9.0/workspaces/arborist/lib/edge.js.
//
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
  #safeName: string
  #safeTo: NodeClass | null

  constructor(options: EdgeOptions) {
    const { accept, from, name } = options
    // Defer to supper to validate options and assign non-private values.
    super(options)
    if (accept !== undefined) {
      this.#safeAccept = accept || '*'
    }
    this.#safeError = null
    this.#safeExplanation = null
    this.#safeFrom = from
    this.#safeName = name
    this.#safeTo = null
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
      if (this.#safeTo) {
        // Patch replacing
        // this.#safeTo.edgesIn.delete(this)
        // is based on https://github.com/npm/cli/pull/7025.
        this.#safeTo.deleteEdgeIn(this)
      }
      this.#safeTo = <NodeClass>newTo ?? null
      this.#safeError = null
      if (this.#safeTo) {
        this.#safeTo.addEdgeIn(this)
      }
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
// is based on https://github.com/npm/cli/blob/v10.9.0/workspaces/arborist/lib/node.js:
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
    log!.silly('Conflicting override sets', this.name)
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
// is based on https://github.com/npm/cli/blob/v10.9.0/workspaces/arborist/lib/override-set.js:
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
// https://github.com/npm/cli/blob/v10.9.0/workspaces/arborist/lib/arborist/index.js:
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
      diff.findIndex(c => c.newPackage.repository_url === NPM_REGISTRY_URL) ===
      -1
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
                // eslint-disable-next-line no-await-in-loop
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
  require.cache[arboristClassPath]!.exports = SafeArborist
  require.cache[arboristEdgeClassPath]!.exports = SafeEdge
  require.cache[arboristNodeClassPath]!.exports = SafeNode
  require.cache[arboristOverrideSetClassPatch]!.exports = SafeOverrideSet
}

void (async () => {
  const remoteSettings = await (async () => {
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
  const { orgs, settings } = remoteSettings
  const enforcedOrgs = getSetting('enforcedOrgs') ?? []

  // Remove any organizations not being enforced.
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
  _uxLookup = createIssueUXLookup(settings)
})()
