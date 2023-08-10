/* eslint-disable no-console */
// THIS MUST BE CJS TO WORK WITH --require
'use strict'

const events = require('events')
const fs = require('fs')
const https = require('https')
const path = require('path')
const rl = require('readline')
const { PassThrough } = require('stream')

const config = require('@socketsecurity/config')

const oraPromise = import('ora')
const isInteractivePromise = import('is-interactive')
const chalkPromise = import('chalk')
const chalkMarkdownPromise = import('../utils/chalk-markdown.js')
const settingsPromise = import('../utils/settings.js')
const sdkPromise = import('../utils/sdk.js')
const createTTYServer = require('./tty-server.cjs')
const { createIssueUXLookup } = require('../utils/issue-rules.cjs')
const { isErrnoException } = require('../utils/type-helpers.cjs')

try {
  // due to update-notifier pkg being ESM only we actually spawn a subprocess sadly
  require('child_process').spawnSync(process.execPath, [
    path.join(__dirname, 'update-notifier.mjs')
  ], {
    stdio: 'inherit'
  })
} catch (e) {
  // ignore if update notification fails
}

/**
 * @typedef {import('stream').Readable} Readable
 */
/**
 * @typedef {import('stream').Writable} Writable
 */

const pubTokenPromise = sdkPromise.then(({ getDefaultKey, FREE_API_KEY }) => getDefaultKey() || FREE_API_KEY)
const apiKeySettingsPromise = sdkPromise.then(async ({ setupSdk }) => {
  const sdk = await setupSdk(await pubTokenPromise)
  const orgResult = await sdk.getOrganizations()
  if (!orgResult.success) {
    throw new Error('Failed to fetch Socket organization info: ' + orgResult.error.message)
  }
  /**
   * @type {(Exclude<typeof orgResult.data.organizations[string], undefined>)[]}
   */
  const orgs = []
  for (const org of Object.values(orgResult.data.organizations)) {
    if (org) {
      orgs.push(org)
    }
  }
  const result = await sdk.postSettings(orgs.map(org => {
    return {
      organization: org.id
    }
  }))
  if (!result.success) {
    throw new Error('Failed to fetch API key settings: ' + result.error.message)
  }
  return {
    orgs,
    settings: result.data
  }
})

/**
 *
 */
async function findSocketYML () {
  let prevDir = null
  let dir = process.cwd()
  const fs = require('fs/promises')
  while (dir !== prevDir) {
    const ymlPath = path.join(dir, 'socket.yml')
    // mark as handled
    const yml = fs.readFile(ymlPath, 'utf-8').catch(() => {})
    const yamlPath = path.join(dir, 'socket.yaml')
    // mark as handled
    const yaml = fs.readFile(yamlPath, 'utf-8').catch(() => {})
    try {
      const txt = await yml
      if (txt != null) {
        return {
          path: ymlPath,
          parsed: config.parseSocketConfig(txt)
        }
      }
    } catch (e) {
      if (isErrnoException(e)) {
        if (e.code !== 'ENOENT' && e.code !== 'EISDIR') {
          throw e
        }
      } else {
        throw new Error('Found file but was unable to parse ' + ymlPath)
      }
    }
    try {
      const txt = await yaml
      if (txt != null) {
        return {
          path: yamlPath,
          parsed: config.parseSocketConfig(txt)
        }
      }
    } catch (e) {
      if (isErrnoException(e)) {
        if (e.code !== 'ENOENT' && e.code !== 'EISDIR') {
          throw e
        }
      } else {
        throw new Error('Found file but was unable to parse ' + yamlPath)
      }
    }
    prevDir = dir
    dir = path.join(dir, '..')
  }
  return null
}

/**
 * @type {Promise<ReturnType<import('../utils/issue-rules.cjs')['createIssueUXLookup']>>}
 */
const uxLookupPromise = settingsPromise.then(async ({ getSetting }) => {
  const enforcedOrgs = getSetting('enforcedOrgs') ?? []
  const { orgs, settings } = await apiKeySettingsPromise

  // remove any organizations not being enforced
  for (const [i, org] of orgs.entries()) {
    if (!enforcedOrgs.includes(org.id)) {
      settings.entries.splice(i, 1)
    }
  }

  const socketYml = await findSocketYML()
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
  return createIssueUXLookup(settings)
})

// shadow `npm` and `npx` to mitigate subshells
require('./link.cjs')(fs.realpathSync(path.join(__dirname, 'bin')), 'npm')

/**
 *
 * @param {string} pkgid
 * @returns {{name: string, version: string}}
 */
const pkgidParts = (pkgid) => {
  const delimiter = pkgid.lastIndexOf('@')
  const name = pkgid.slice(0, delimiter)
  const version = pkgid.slice(delimiter + 1)
  return { name, version }
}

/**
 * @typedef PURLParts
 * @property {'npm'} type
 * @property {string} namespace_and_name
 * @property {string} version
 * @property {URL['href']} repository_url
 */

/**
 * @param {string[]} pkgids
 * @returns {AsyncGenerator<{eco: string, pkg: string, ver: string } & ({type: 'missing'} | {type: 'success', value: { issues: any[] }})>}
 */
async function * batchScan (
  pkgids
) {
  const pubToken = await pubTokenPromise
  const query = {
    packages: pkgids.map(pkgid => {
      const { name, version } = pkgidParts(pkgid)
      return {
        eco: 'npm', pkg: name, ver: version, top: true
      }
    })
  }
  // TODO: migrate to SDK
  const pkgDataReq = https.request(
    'https://api.socket.dev/v0/scan/batch',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${pubToken}:`).toString('base64url')}`
      }
    }
  ).end(
    JSON.stringify(query)
  )
  const [res] = await events.once(pkgDataReq, 'response')
  const isSuccess = res.statusCode === 200
  if (!isSuccess) {
    throw new Error('Socket API Error: ' + res.statusCode)
  }
  const rli = rl.createInterface(res)
  for await (const line of rli) {
    const result = JSON.parse(line)
    yield result
  }
}

/**
 * @type {import('./translations.json') | null}
 */
let translations = null
/**
 * @type {import('../utils/chalk-markdown.js').ChalkOrMarkdown | null}
 */
let formatter = null

const ttyServerPromise = chalkPromise.then(async (chalk) => {
  return createTTYServer(chalk.default.level, (await isInteractivePromise).default({
    stream: process.stdin
  }), npmlog)
})

const npmEntrypoint = fs.realpathSync(`${process.argv[1]}`)
/**
 * @param {string} filepath
 * @returns {string}
 */
function findRoot (filepath) {
  if (path.basename(filepath) === 'npm') {
    return filepath
  }
  const parent = path.dirname(filepath)
  if (parent === filepath) {
    process.exit(127)
  }
  return findRoot(parent)
}
const npmDir = findRoot(path.dirname(npmEntrypoint))
const arboristLibClassPath = path.join(npmDir, 'node_modules', '@npmcli', 'arborist', 'lib', 'arborist', 'index.js')
const npmlog = require(path.join(npmDir, 'node_modules', 'npmlog', 'lib', 'log.js'))
/**
 * @type {import('pacote')}
 */
const pacote = require(path.join(npmDir, 'node_modules', 'pacote'))

/**
 * @type {typeof import('@npmcli/arborist')}
 */
const Arborist = require(arboristLibClassPath)

const kCtorArgs = Symbol('ctorArgs')
const kRiskyReify = Symbol('riskyReify')
class SafeArborist extends Arborist {
  /**
   * @param {ConstructorParameters<typeof Arborist>} ctorArgs
   */
  constructor (...ctorArgs) {
    const mutedArguments = [{
      ...(ctorArgs[0] ?? {}),
      audit: true,
      dryRun: true,
      ignoreScripts: true,
      save: false,
      saveBundle: false,
      // progress: false,
      fund: false
    }, ctorArgs.slice(1)]
    super(...mutedArguments)
    this[kCtorArgs] = ctorArgs
  }

  /**
   * @param {Parameters<InstanceType<typeof Arborist>['reify']>} args
   */
  async [kRiskyReify] (...args) {
    // safe arborist has suffered side effects and must be rebuilt from scratch
    const arb = new Arborist(...this[kCtorArgs])
    const ret = await arb.reify(...args)
    Object.assign(this, arb)
    return ret
  }

  /**
   * @param {Parameters<InstanceType<typeof Arborist>['reify']>} args
   * @override
   */
  async reify (...args) {
    // @ts-expect-error types are wrong
    if (args[0]?.dryRun) {
      return this[kRiskyReify](...args)
    }
    args[0] ??= {}
    const old = {
      dryRun: false,
      save: Boolean(args[0].save ?? true),
      saveBundle: Boolean(args[0].saveBundle ?? false),
      ...args[0]
    }
    // @ts-expect-error types are wrong
    args[0].dryRun = true
    args[0].save = false
    args[0].saveBundle = false
    // const originalDescriptors = Object.getOwnPropertyDescriptors(this)
    // TODO: make this deal w/ any refactor to private fields by punching the class itself
    await super.reify(...args)
    const diff = gatherDiff(this)
    // @ts-expect-error types are wrong
    args[0].dryRun = old.dryRun
    args[0].save = old.save
    args[0].saveBundle = old.saveBundle
    // nothing to check, mmm already installed or all private?
    if (diff.findIndex(c => c.newPackage.repository_url === 'https://registry.npmjs.org') === -1) {
      return this[kRiskyReify](...args)
    }
    const ttyServer = await ttyServerPromise
    const proceed = await ttyServer.captureTTY(async (input, output, colorLevel) => {
      if (input && output) {
        const chalkNS = await chalkPromise
        chalkNS.default.level = colorLevel
        const oraNS = await oraPromise
        const ora = () => {
          return oraNS.default({
            stream: output,
            color: 'cyan',
            isEnabled: true,
            isSilent: false,
            hideCursor: true,
            discardStdin: true,
            spinner: oraNS.spinners.dots,
          })
        }
        const risky = await packagesHaveRiskyIssues(this, this.registry, diff, ora, input, output)
        if (!risky) {
          return true
        }
        const rl = require('readline')
        const rlin = new PassThrough()
        input.pipe(rlin, {
          end: true
        })
        const rlout = new PassThrough()
        rlout.pipe(output, {
          end: false
        })
        const rli = rl.createInterface(rlin, rlout)
        try {
          while (true) {
            /**
             * @type {string}
             */
            const answer = await new Promise((resolve) => {
              rli.question('Accept risks of installing these packages (y/N)? ', (str) => resolve(str))
            })
            if (/^\s*y(es)?\s*$/i.test(answer)) {
              return true
            } else if (/^(\s*no?\s*|)$/i.test(answer)) {
              return false
            }
          }
        } finally {
          rli.close()
        }
      } else {
        if (await packagesHaveRiskyIssues(this, this.registry, diff, null, null, output)) {
          throw new Error('Socket npm Unable to prompt to accept risk, need TTY to do so')
        }
        return true
      }
      // @ts-ignore paranoia
      // eslint-disable-next-line
      return false
    })
    if (proceed) {
      return this[kRiskyReify](...args)
    } else {
      throw new Error('Socket npm exiting due to risks')
    }
  }
}
// @ts-ignore
require.cache[arboristLibClassPath].exports = SafeArborist

/**
 * @typedef {{
 *   check: InstallEffect[],
 *   unknowns: InstallEffect[]
 * }} InstallDiff
 */

/**
 * @param {InstanceType<typeof Arborist>} arb
 * @returns {InstallEffect[]}
 */
function gatherDiff (arb) {
  return walk(arb.diff)
}
/**
 * @typedef InstallEffect
 * @property {import('@npmcli/arborist').Diff['action']} action
 * @property {import('@npmcli/arborist').Node['pkgid'] | null} existing
 * @property {import('@npmcli/arborist').Node['pkgid']} pkgid
 * @property {import('@npmcli/arborist').Node['resolved']} resolved
 * @property {import('@npmcli/arborist').Node['location']} location
 * @property {PURLParts | null} oldPackage
 * @property {PURLParts} newPackage
 */
/**
 * @param {import('@npmcli/arborist').Diff | null} diff
 * @param {InstallEffect[]} needInfoOn
 * @returns {InstallEffect[]}
 */
function walk (diff, needInfoOn = []) {
  if (!diff) {
    return needInfoOn
  }

  if (diff.action) {
    const sameVersion = diff.actual?.package.version === diff.ideal?.package.version
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
    if (keep) {
      if (diff.ideal?.pkgid) {
        /**
         *
         * @param {string} pkgid - `pkg@ver`
         * @param {string} resolved - tarball link, should match `/name/-/name-ver.tgz` as tail, used to obtain repository_url
         * @returns {PURLParts}
         */
        function toPURL (pkgid, resolved) {
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
        if (diff.ideal.resolved && (!diff.actual || diff.actual.resolved)) {
          needInfoOn.push({
            existing,
            action: diff.action,
            location: diff.ideal.location,
            pkgid: diff.ideal.pkgid,
            newPackage: toPURL(diff.ideal.pkgid, diff.ideal.resolved),
            oldPackage: diff.actual && diff.actual.resolved ? toPURL(diff.actual.pkgid, diff.actual.resolved) : null,
            resolved: diff.ideal.resolved,
          })
        }
      }
    }
  }
  if (diff.children) {
    for (const child of diff.children) {
      walk(child, needInfoOn)
    }
  }
  return needInfoOn
}

/**
 * @param {SafeArborist} safeArb
 * @param {string} _registry
 * @param {InstallEffect[]} pkgs
 * @param {import('ora')['default'] | null} ora
 * @param {Readable | null} [_input]
 * @param {Writable | null} [output]
 * @returns {Promise<boolean>}
 */
async function packagesHaveRiskyIssues (safeArb, _registry, pkgs, ora = null, _input, output) {
  let failed = false
  if (pkgs.length) {
    let remaining = pkgs.length
    /**
     *
     * @returns {string}
     */
    function getText () {
      return `Looking up data for ${remaining} packages`
    }
    const spinner = ora ? ora().start(getText()) : null
    const pkgDatas = []
    try {
      // TODO: determine org based on cwd, pass in
      const uxLookup = await uxLookupPromise

      for await (const pkgData of batchScan(pkgs.map(pkg => pkg.pkgid))) {
        /**
         * @type {Array<any>}
         */
        let failures = []
        let displayWarning = false
        const name = pkgData.pkg
        const version = pkgData.ver
        let blocked = false
        if (pkgData.type === 'missing') {
          failed = true
          failures.push({
            type: 'missingDependency'
          })
          continue
        } else {
          for (const failure of pkgData.value.issues) {
            const ux = await uxLookup({ package: { name, version }, issue: { type: failure.type } })
            if (ux.display || ux.block) {
              failures.push({ raw: failure, block: ux.block })
              // before we ask about problematic issues, check to see if they already existed in the old version
              // if they did, be quiet
              const pkg = pkgs.find(pkg => pkg.pkgid === `${pkgData.pkg}@${pkgData.ver}` && pkg.existing?.startsWith(pkgData.pkg + '@'))
              if (pkg?.existing) {
                for await (const oldPkgData of batchScan([pkg.existing])) {
                  if (oldPkgData.type === 'success') {
                    failures = failures.filter(
                      issue => oldPkgData.value.issues.find(oldIssue => oldIssue.type === issue.raw.type) == null
                    )
                  }
                }
              }
            }
            if (ux.block) {
              failed = true
              blocked = true
            }
            if (ux.display) {
              displayWarning = true
            }
          }
        }
        if (!blocked) {
          const pkg = pkgs.find(pkg => pkg.pkgid === `${pkgData.pkg}@${pkgData.ver}`)
          if (pkg) {
            pacote.tarball.stream(pkg.pkgid, (stream) => {
              stream.resume()
              // @ts-ignore pacote does a naughty
              return stream.promise()
            }, { ...safeArb[kCtorArgs][0] })
          }
        }
        if (displayWarning) {
          translations ??= JSON.parse(fs.readFileSync(path.join(__dirname, '/translations.json'), 'utf-8'))
          formatter ??= new ((await chalkMarkdownPromise).ChalkOrMarkdown)(false)
          spinner?.stop()
          output?.write(`(socket) ${formatter.hyperlink(`${name}@${version}`, `https://socket.dev/npm/package/${name}/overview/${version}`)} contains risks:\n`)
          const lines = new Set()
          for (const failure of failures.sort((a, b) => a.raw.type < b.raw.type ? -1 : 1)) {
            const type = failure.raw.type
            if (type) {
              // @ts-ignore
              const issueTypeTranslation = translations.issues[type]
              // TODO: emoji seems to misalign terminals sometimes
              // @ts-ignore
              lines.add(`  ${issueTypeTranslation?.title ?? type}${failure.block ? '' : ' (non-blocking)'} - ${issueTypeTranslation?.description ?? ''}\n`)
            }
          }
          for (const line of lines) {
            output?.write(line)
          }
          spinner?.start()
        }
        remaining--
        if (remaining !== 0) {
          if (spinner) {
            spinner.text = getText()
          }
        }
        pkgDatas.push(pkgData)
      }
      return failed
    } finally {
      if (spinner?.isSpinning) {
        spinner?.stop()
      }
    }
  } else {
    if (ora) {
      ora('').succeed('No changes detected')
    }
    return false
  }
}
