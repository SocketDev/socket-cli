/* eslint-disable no-console */
// THIS MUST BE CJS TO WORK WITH --require
'use strict'

const fs = require('fs')
const path = require('path')
const https = require('https')
const events = require('events')
const rl = require('readline')
const { PassThrough } = require('stream')
const oraPromise = import('ora')
const isInteractivePromise = import('is-interactive')
const chalkPromise = import('chalk')
const chalkMarkdownPromise = import('../utils/chalk-markdown.js')
const ipc_version = require('../../package.json').version

/**
 * @typedef {import('stream').Readable} Readable
 */
/**
 * @typedef {import('stream').Writable} Writable
 */

const pubToken = 'sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api'

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
  const query = {
    packages: pkgids.map(pkgid => {
      const { name, version } = pkgidParts(pkgid)
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

const ttyServerPromise = chalkPromise.then(chalk => {
  return createTTYServer(chalk.default.level)
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
    args[0].save = old.save
    args[0].saveBundle = old.saveBundle
    // nothing to check, mmm already installed or all private?
    if (diff.findIndex(c => c.newPackage.repository_url === 'https://registry.npmjs.org') === -1) {
      return this[kRiskyReify](...args)
    }
    const ttyServer = await ttyServerPromise
    const proceed = await ttyServer.captureTTY(async (input, output, colorLevel) => {
      if (input) {
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
        const risky = await packagesHaveRiskyIssues(this.registry, diff, ora, input, output)
        if (!risky) {
          return true
        }
        const rl = require('readline')
        const rli = rl.createInterface(input, output)
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
      } else {
        if (await packagesHaveRiskyIssues(this.registry, diff, null, null, output)) {
          throw new Error('Socket npm Unable to prompt to accept risk, need TTY to do so')
        }
        return true
      }
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
 * @param {string} registry
 * @param {InstallEffect[]} pkgs
 * @param {import('ora')['default'] | null} ora
 * @param {Readable | null} input
 * @param {Writable} ora
 * @returns {Promise<boolean>}
 */
async function packagesHaveRiskyIssues (registry, pkgs, ora = null, input, output) {
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
          output.write(`(socket) ${formatter.hyperlink(`${name}@${version}`, `https://socket.dev/npm/package/${name}/overview/${version}`)} contains risks:\n`)
          if (translations) {
            for (const failure of failures) {
              const type = failure.type
              if (type) {
                // @ts-ignore
                const issueTypeTranslation = translations.issues[type]
                // TODO: emoji seems to misalign terminals sometimes
                // @ts-ignore
                const msg = `  ${issueTypeTranslation.title} - ${issueTypeTranslation.description}\n`
                output.write(msg)
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

/**
 * @param {import('chalk')['default']['level']} colorLevel
 * @returns {Promise<{ captureTTY<RET extends any>(mutexFn: (input: Readable | null, output: Writable, colorLevel: import('chalk')['default']['level']) => Promise<RET>): Promise<RET> }>}
 */
async function createTTYServer (colorLevel) {
  const TTY_IPC = process.env.SOCKET_SECURITY_TTY_IPC
  const net = require('net')
  /**
   * @type {import('readline')}
   */
  let readline
  const isSTDINInteractive = (await isInteractivePromise).default({
    stream: process.stdin
  })
  if (!isSTDINInteractive && TTY_IPC) {
    return {
      async captureTTY (mutexFn) {
        return new Promise((resolve, reject) => {
          const conn = net.createConnection({
            path: TTY_IPC
          }).on('error', reject)
          let captured = false
          conn.on('data', function awaitCapture (d) {
            try {
              if (!captured) {
                const EOL = d.indexOf('\n'.charCodeAt(0))
                if (EOL !== -1) {
                  conn.removeListener('data', awaitCapture)
                  captured = true
                  const {
                    ipc_version: remote_ipc_version,
                    capabilities: { input: hasInput, output: hasOutput, colorLevel: ipcColorLevel }
                  } = JSON.parse(d.slice(0, EOL).toString('utf-8'))
                  if (remote_ipc_version !== ipc_version) {
                    throw new Error('Mismatched STDIO tunnel IPC version, ensure you only have 1 version of socket CLI being called.')
                  }
                  const input = hasInput ? new PassThrough() : null
                  input.pause()
                  // conn.push(d.slice(EOL + 1))
                  conn.pipe(input)
                  const output = hasOutput ? new PassThrough() : null
                  output.pipe(conn)
                  // make ora happy
                  // @ts-ignore
                  output.isTTY = true
                  // @ts-ignore
                  output.cursorTo = function cursorTo (x, y, callback) {
                    readline = readline || require('readline')
                    readline.cursorTo(this, x, y, callback)
                  }
                  // @ts-ignore
                  output.clearLine = function clearLine (dir, callback) {
                    readline = readline || require('readline')
                    readline.clearLine(this, dir, callback)
                  }
                  mutexFn(hasInput ? input : null, hasOutput ? output : null, ipcColorLevel)
                    .then(resolve, reject)
                    .finally(() => {
                      conn.unref()
                      conn.end()
                      input.end()
                      output.end()
                      // process.exit(13)
                    })
                }
              }
            } catch (e) {
              reject(e)
            }
          })
        })
      }
    }
  }
  const pendingCaptures = []
  let captured = false
  const sock = path.join(require('os').tmpdir(), `socket-security-tty-${process.pid}.sock`)
  process.env.SOCKET_SECURITY_TTY_IPC = sock
  try {
    await require('fs/promises').unlink(sock)
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e
    }
  }
  process.on('beforeExit', () => {
    ttyServer.close()
    try {
      require('fs').unlinkSync(sock)
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e
      }
    }
  })
  const input = isSTDINInteractive ? process.stdin : null
  const output = process.stderr
  const ttyServer = await new Promise((resolve, reject) => {
    const server = net.createServer(async (conn) => {
      if (captured) {
        const captured = new Promise((resolve) => {
          pendingCaptures.push({
            resolve
          })
        })
        await captured
      } else {
        captured = true
      }
      const wasProgressEnabled = npmlog.progressEnabled
      npmlog.pause()
      if (wasProgressEnabled) {
        npmlog.disableProgress()
      }
      conn.write(`${JSON.stringify({
        ipc_version,
        capabilities: {
          input: Boolean(input),
          output: true,
          colorLevel
        }
      })}\n`)
      conn.on('data', (data) => {
        output.write(data)
      })
      conn.on('error', (e) => {
        output.write(`there was an error prompting from a subshell (${e.message}), socket npm closing`)
        process.exit(1)
      })
      input.on('data', (data) => {
        conn.write(data)
      })
      input.on('end', () => {
        conn.unref()
        conn.end()
        if (wasProgressEnabled) {
          npmlog.enableProgress()
        }
        npmlog.resume()
        nextCapture()
      })
    }).listen(sock, (err) => {
      if (err) reject(err)
      else resolve(server)
    }).unref()
  })
  /**
   *
   */
  function nextCapture () {
    if (pendingCaptures.length > 0) {
      const nextCapture = pendingCaptures.shift()
      nextCapture.resolve()
    } else {
      captured = false
    }
  }
  return {
    async captureTTY (mutexFn) {
      if (captured) {
        const captured = new Promise((resolve) => {
          pendingCaptures.push({
            resolve
          })
        })
        await captured
      } else {
        captured = true
      }
      const wasProgressEnabled = npmlog.progressEnabled
      try {
        npmlog.pause()
        if (wasProgressEnabled) {
          npmlog.disableProgress()
        }
        // need await here for proper finally timing
        return await mutexFn(input, output, colorLevel)
      } finally {
        if (wasProgressEnabled) {
          npmlog.enableProgress()
        }
        npmlog.resume()
        nextCapture()
      }
    }
  }
}
