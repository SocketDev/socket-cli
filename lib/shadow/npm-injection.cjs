// THIS MUST BE CJS TO WORK WITH --require
/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')
const https = require('https')
const events = require('events')
const rl = require('readline')
const oraPromise = import('ora')
const isInteractivePromise = import('is-interactive')
const chalkMarkdownPromise = import('../utils/chalk-markdown.js')

const pubToken = 'sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api'

// shadow `npm` and `npx` to mitigate subshells
require('./link.cjs')(fs.realpathSync(path.join(__dirname, 'bin')), 'npm')

/**
 * @param {string[]} pkgids
 * @returns {AsyncGenerator<{eco: string, pkg: string, ver: string } & ({type: 'missing'} | {type: 'success', value: { issues: any[] }})>}
 */
async function * batchScan (
  pkgids
) {
  const query = {
    packages: pkgids.map(pkgid => {
      const delimiter = pkgid.lastIndexOf('@')
      const name = pkgid.slice(0, delimiter)
      const version = pkgid.slice(delimiter + 1)
      return {
        eco: 'npm', pkg: name, ver: version, top: true
      }
    })
  }
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
      dryRun: true,
      ignoreScripts: true,
      save: false,
      saveBundle: false,
      audit: false,
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
    const old = { ...args[0] }
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
    // @ts-expect-error types are wrong
    args[0].save = old.save
    // @ts-expect-error types are wrong
    args[0].saveBundle = old.saveBundle
    // nothing to check, mmm already installed?
    if (diff.check.length === 0 && diff.unknowns.length === 0) {
      return this[kRiskyReify](...args)
    }
    const isInteractive = (await isInteractivePromise).default()
    if (isInteractive) {
      const ora = (await oraPromise).default
      const risky = await packagesHaveRiskyIssues(diff.check, ora)
      if (risky) {
        const rl = require('readline')
        const rli = rl.createInterface(process.stdin, process.stderr)
        while (true) {
          /**
           * @type {string}
           */
          const answer = await new Promise((resolve) => {
            rli.question('Accept risks of installing these packages (y/N)? ', (str) => resolve(str))
          })
          if (/^\s*y(es)?\s*$/i.test(answer)) {
            break
          } else if (/^(\s*no?\s*|)$/i.test(answer)) {
            throw new Error('Socket npm exiting due to risks')
          }
        }
      }
      return this[kRiskyReify](...args)
    } else {
      await packagesHaveRiskyIssues(diff.check)
      throw new Error('Socket npm Unable to prompt to accept risk, need TTY to do so')
    }
  }
}
// @ts-ignore
require.cache[arboristLibClassPath].exports = SafeArborist

/**
 * @param {InstanceType<typeof Arborist>} arb
 * @returns {{
 *   check: InstallEffect[],
 *   unknowns: InstallEffect[]
 * }}
 */
function gatherDiff (arb) {
  // TODO: make this support private registry complexities
  const registry = arb.registry
  /**
   * @type {InstallEffect[]}
   */
  const unknowns = []
  /**
   * @type {InstallEffect[]}
   */
  const check = []
  for (const node of walk(arb.diff)) {
    if (node.resolved?.startsWith(registry)) {
      check.push(node)
    } else {
      unknowns.push(node)
    }
  }
  return {
    check,
    unknowns
  }
}
/**
 * @typedef InstallEffect
 * @property {import('@npmcli/arborist').Diff['action']} action
 * @property {import('@npmcli/arborist').Node['pkgid'] | null} existing
 * @property {import('@npmcli/arborist').Node['pkgid']} pkgid
 * @property {import('@npmcli/arborist').Node['resolved']} resolved
 * @property {import('@npmcli/arborist').Node['location']} location
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
        needInfoOn.push({
          existing,
          action: diff.action,
          location: diff.ideal.location,
          pkgid: diff.ideal.pkgid,
          resolved: diff.ideal.resolved
        })
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
 * @param {InstallEffect[]} pkgs
 * @param {import('ora')['default'] | null} ora
 * @returns {Promise<boolean>}
 */
async function packagesHaveRiskyIssues (pkgs, ora = null) {
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
    const spinner = ora ? ora(getText()).start() : null
    const pkgDatas = []
    try {
      for await (const pkgData of batchScan(pkgs.map(pkg => pkg.pkgid))) {
        let failures = []
        if (pkgData.type === 'missing') {
          failures.push({
            type: 'missingDependency'
          })
          continue
        }
        for (const issue of (pkgData.value?.issues ?? [])) {
          if ([
            'shellScriptOverride',
            'gitDependency',
            'httpDependency',
            'installScripts',
            'malware',
            'didYouMean',
            'hasNativeCode',
            'troll',
            'telemetry',
            'invalidPackageJSON',
            'unresolvedRequire',
          ].includes(issue.type)) {
            failures.push(issue)
          }
        }
        // before we ask about problematic issues, check to see if they already existed in the old version
        // if they did, be quiet
        if (failures.length) {
          const pkg = pkgs.find(pkg => pkg.pkgid === `${pkgData.pkg}@${pkgData.ver}` && pkg.existing?.startsWith(pkgData.pkg))
          if (pkg?.existing) {
            for await (const oldPkgData of batchScan([pkg.existing])) {
              if (oldPkgData.type === 'success') {
                failures = failures.filter(
                  issue => oldPkgData.value.issues.find(oldIssue => oldIssue.type === issue.type) == null
                )
              }
            }
          }
        }
        if (failures.length) {
          failed = true
          spinner?.stop()
          translations ??= JSON.parse(fs.readFileSync(path.join(__dirname, '/translations.json'), 'utf-8'))
          formatter ??= new ((await chalkMarkdownPromise).ChalkOrMarkdown)(false)
          const name = pkgData.pkg
          const version = pkgData.ver
          console.error(`${formatter.hyperlink(`${name}@${version}`, `https://socket.dev/npm/package/${name}/overview/${version}`)} contains risks:`)
          if (translations) {
            for (const failure of failures) {
              const type = failure.type
              if (type) {
                // @ts-ignore
                const issueTypeTranslation = translations.issues[type]
                // TODO: emoji seems to misalign terminals sometimes
                // @ts-ignore
                const msg = `  ${issueTypeTranslation.title} - ${issueTypeTranslation.description}`
                console.error(msg)
              }
            }
          }
          spinner?.start()
        } else {
          // TODO: have pacote/cacache download non-problematic files while waiting
        }
        remaining--
        if (remaining !== 0) {
          if (spinner) {
            spinner.text = getText()
          }
        } else {
          spinner?.stop()
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
