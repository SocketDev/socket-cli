const path = require('path')
const { PassThrough } = require('stream')

const ipc_version = require('../../package.json').version
const { isErrnoException } = require('../utils/type-helpers.cjs')

/**
 * @typedef {import('stream').Readable} Readable
 */
/**
 * @typedef {import('stream').Writable} Writable
 */
/**
 * @param {import('chalk')['default']['level']} colorLevel
 * @param {boolean} isInteractive
 * @param {any} npmlog
 * @returns {Promise<{ captureTTY<RET extends any>(mutexFn: (input: Readable | null, output?: Writable, colorLevel: import('chalk')['default']['level']) => Promise<RET>): Promise<RET> }>}
 */
module.exports = async function createTTYServer (colorLevel, isInteractive, npmlog) {
  const TTY_IPC = process.env['SOCKET_SECURITY_TTY_IPC']
  const net = require('net')
  /**
   * @type {import('readline')}
   */
  let readline
  const isSTDINInteractive = true || isInteractive
  if (!isSTDINInteractive && TTY_IPC) {
    return {
      async captureTTY (mutexFn) {
        return new Promise((resolve, reject) => {
          const conn = net.createConnection({
            path: TTY_IPC
          }).on('error', reject)
          let captured = false
          /**
           * @type {Array<Buffer>}
           */
          const bufs = []
          conn.on('data', function awaitCapture (chunk) {
            bufs.push(chunk)
            /**
             * @type {Buffer | null}
             */
            let lineBuff = Buffer.concat(bufs)
            try {
              if (!captured) {
                const EOL = lineBuff.indexOf('\n'.charCodeAt(0))
                if (EOL !== -1) {
                  conn.removeListener('data', awaitCapture)
                  conn.push(lineBuff.slice(EOL + 1))
                  const {
                    ipc_version: remote_ipc_version,
                    capabilities: { input: hasInput, output: hasOutput, colorLevel: ipcColorLevel }
                  } = JSON.parse(lineBuff.slice(0, EOL).toString('utf-8'))
                  lineBuff = null
                  captured = true
                  if (remote_ipc_version !== ipc_version) {
                    throw new Error('Mismatched STDIO tunnel IPC version, ensure you only have 1 version of socket CLI being called.')
                  }
                  const input = hasInput ? new PassThrough() : null
                  input?.pause()
                  if (input) conn.pipe(input)
                  const output = hasOutput ? new PassThrough() : null
                  output?.pipe(conn)
                  // make ora happy
                  // @ts-ignore
                  output.isTTY = true
                  // @ts-ignore
                  output.cursorTo = function cursorTo (x, y, callback) {
                    readline = readline || require('readline')
                    // @ts-ignore
                    readline.cursorTo(this, x, y, callback)
                  }
                  // @ts-ignore
                  output.clearLine = function clearLine (dir, callback) {
                    readline = readline || require('readline')
                    // @ts-ignore
                    readline.clearLine(this, dir, callback)
                  }
                  mutexFn(hasInput ? input : null, hasOutput ? /** @type {Writable} */(output) : undefined, ipcColorLevel)
                    .then(resolve, reject)
                    .finally(() => {
                      conn.unref()
                      conn.end()
                      input?.end()
                      output?.end()
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
  /**
   * @type {Array<{resolve(): void}>}}
   */
  const pendingCaptures = []
  let captured = false
  const sock = path.join(require('os').tmpdir(), `socket-security-tty-${process.pid}.sock`)
  process.env['SOCKET_SECURITY_TTY_IPC'] = sock
  try {
    await require('fs/promises').unlink(sock)
  } catch (e) {
    if (isErrnoException(e) && e.code !== 'ENOENT') {
      throw e
    }
  }
  const input = isSTDINInteractive ? process.stdin : null
  const output = process.stderr
  if (input) {
    await new Promise((resolve, reject) => {
      const server = net.createServer(async (conn) => {
        if (captured) {
          const captured = new Promise((resolve) => {
            pendingCaptures.push({
              resolve () {
                resolve(undefined)
              }
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
      }).listen(sock, () => resolve(server)).on('error', (err) => {
        reject(err)
      }).unref()
      process.on('exit', () => {
        server.close()
        try {
          require('fs').unlinkSync(sock)
        } catch (e) {
          if (isErrnoException(e) && e.code !== 'ENOENT') {
            throw e
          }
        }
      })
      resolve(server)
    })
  }
  /**
   *
   */
  function nextCapture () {
    if (pendingCaptures.length > 0) {
      const nextCapture = pendingCaptures.shift()
      if (nextCapture) {
        nextCapture.resolve()
      }
    } else {
      captured = false
    }
  }
  return {
    async captureTTY (mutexFn) {
      if (captured) {
        const captured = new Promise((resolve) => {
          pendingCaptures.push({
            resolve () {
              resolve(undefined)
            }
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
