import events from 'node:events'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import rl from 'node:readline'
import { PassThrough } from 'node:stream'
import { setTimeout as wait } from 'node:timers/promises'

import config from '@socketsecurity/config'
import chalk from 'chalk'
import isInteractive from 'is-interactive'
import ora, { spinners } from 'ora'

import { installLinks } from './link'
import { createTTYServer } from './tty-server'
import { ChalkOrMarkdown } from '../utils/chalk-markdown'
import { createIssueUXLookup } from '../utils/issue-rules'
import { isErrnoException } from '../utils/misc'
import { findRoot } from '../utils/path-resolve'
import { getDefaultKey, FREE_API_KEY, setupSdk } from '../utils/sdk'
import { getSetting } from '../utils/settings'

import type {
  Arborist as BaseArborist,
  Diff,
  Node,
  Options as ArboristOptions
} from '@npmcli/arborist'
import type { Writable } from 'node:stream'
import type { Options as OraOptions } from 'ora'

type ArboristClass = typeof BaseArborist & {
  new (...args: any): any
}

type InstallEffect = {
  action: Diff['action']
  existing: Node['pkgid'] | null
  pkgid: Node['pkgid']
  resolved: Node['resolved']
  location: Node['location']
  oldPackage: PURLParts | null
  newPackage: PURLParts
}

type PURLParts = {
  type: 'npm'
  namespace_and_name: string
  version: string
  repository_url: URL['href']
}

const LOOP_SENTINEL = 1_000_000

const distPath = __dirname
const rootPath = path.resolve(distPath, '..')
const binPath = path.join(rootPath, 'bin')

const npmEntrypoint = realpathSync(`${process.argv[1]}`)
const npmRootPath = findRoot(path.dirname(npmEntrypoint))

const POTENTIALLY_BUG_ERROR_SNIPPET =
  'this is potentially a bug with socket-npm caused by changes to the npm cli'

const abortController = new AbortController()
const { signal: abortSignal } = abortController

const translations = require(path.join(rootPath, 'translations.json'))

if (npmRootPath === undefined) {
  console.error(
    `Unable to find npm cli install directory, ${POTENTIALLY_BUG_ERROR_SNIPPET}.`
  )
  console.error(`Searched parent directories of ${npmEntrypoint}`)
  process.exit(127)
}

const npmDepPath = path.join(npmRootPath, 'node_modules')
const arboristClassPath = path.join(
  npmDepPath,
  '@npmcli/arborist/lib/arborist/index.js'
)

const Arborist: ArboristClass = require(arboristClassPath)

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let tarball: typeof import('pacote').tarball
try {
  tarball = require(path.join(npmDepPath, 'pacote')).tarball
} catch {
  tarball = require('pacote').tarball
}

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let npmlog: typeof import('npmlog') | undefined
try {
  npmlog = require(path.join(npmDepPath, 'proc-log/lib/index.js')).log
} catch {}
if (npmlog === undefined) {
  try {
    npmlog = require(path.join(npmDepPath, 'npmlog/lib/log.js'))
  } catch {}
}
if (npmlog === undefined) {
  console.error(
    `Unable to integrate with npm cli logging infrastructure, ${POTENTIALLY_BUG_ERROR_SNIPPET}.`
  )
  process.exit(127)
}

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
  // eslint-disable-next-line no-unmodified-loop-condition
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
  // TODO: migrate to SDK
  const pkgDataReq = https
    .request('https://api.socket.dev/v0/scan/batch', {
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

function findSocketYML() {
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

function maybeReadfileSync(filepath: string): string | undefined {
  try {
    return existsSync(filepath) ? readFileSync(filepath, 'utf8') : undefined
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
          const ux = await uxLookup({
            package: { name, version },
            issue: { type: failure.type }
          })
          if (ux.display || ux.block) {
            failures.push({ raw: failure, block: ux.block })
            // before we ask about problematic issues, check to see if they
            // already existed in the old version if they did, be quiet
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
      remaining--
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

class SafeArborist extends Arborist {
  constructor(...ctorArgs: ConstructorParameters<ArboristClass>) {
    const mutedArguments = [
      {
        ...(ctorArgs[0] ?? {}),
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
  ): Promise<Node> {
    // safe arborist has suffered side effects and must be rebuilt from scratch
    const arb = new Arborist(...(this as any)[kCtorArgs])
    const ret = await arb.reify(...args)
    Object.assign(this, arb)
    return ret
  }

  async reify(
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<Node> {
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
    // TODO: make this deal w/ any refactor to private fields by punching the class itself
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
    const proceed = await ttyServer.captureTTY(
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
    if (proceed) {
      return await this[kRiskyReify](...args)
    } else {
      throw new Error('Socket npm exiting due to risks')
    }
  }
}

require.cache[arboristClassPath]!.exports = SafeArborist

async function main() {
  // shadow `npm` and `npx` to mitigate subshells
  installLinks(realpathSync(binPath), 'npm')

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

  const socketYml = findSocketYML()
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
}
void main()
