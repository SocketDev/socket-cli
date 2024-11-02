import { unlinkSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { PassThrough } from 'node:stream'

import { version as ipc_version } from '../../package.json'
import { isErrnoException } from '../utils/misc'

import type { ColorSupportLevel } from 'chalk'
import type { Server } from 'node:net'
import type { Direction } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

const NEWLINE_CHAR_CODE = 10 /*'\n'*/

const TTY_IPC = process.env['SOCKET_SECURITY_TTY_IPC']

type CaptureState = {
  captured: boolean
  nextCapture: () => void
  pendingCaptures: { resolve(): void }[]
}

type TTYSeverResult = {
  captureTTY<RET>(
    mutexFn: (
      colorLevel: ColorSupportLevel,
      input?: Readable | undefined,
      output?: Writable | undefined
    ) => Promise<RET>
  ): Promise<RET>
}

const sock = path.join(os.tmpdir(), `socket-security-tty-${process.pid}.sock`)
process.env['SOCKET_SECURITY_TTY_IPC'] = sock

function createNonStandardTTYServer(): TTYSeverResult {
  return {
    async captureTTY(mutexFn) {
      return await new Promise((resolve, reject) => {
        const conn = net
          .createConnection({
            path: TTY_IPC!
          })
          .on('error', reject)
        let captured = false
        const buffs: Uint8Array[] = []
        conn.on('data', function awaitCapture(chunk: Uint8Array) {
          buffs.push(chunk)
          let lineBuff: Buffer | null = Buffer.concat(buffs)
          if (captured) return
          try {
            const eolIndex = lineBuff.indexOf(NEWLINE_CHAR_CODE)
            if (eolIndex !== -1) {
              conn.removeListener('data', awaitCapture)
              conn.push(lineBuff.slice(eolIndex + 1))
              const {
                capabilities: {
                  colorLevel: ipcColorLevel,
                  input: hasInput,
                  output: hasOutput
                },
                ipc_version: remote_ipc_version
              } = JSON.parse(lineBuff.slice(0, eolIndex).toString('utf-8'))
              lineBuff = null
              captured = true
              if (remote_ipc_version !== ipc_version) {
                throw new Error(
                  'Mismatched STDIO tunnel IPC version, ensure you only have 1 version of socket CLI being called.'
                )
              }
              const input = hasInput ? new PassThrough() : null
              input?.pause()
              if (input) conn.pipe(input)
              const output = hasOutput ? new PassThrough() : null
              if (output) {
                output.pipe(conn)
                // Make ora happy
                ;(output as any).isTTY = true
                ;(output as any).cursorTo = function cursorTo(
                  x: number,
                  y: number,
                  callback?: (() => void) | undefined
                ) {
                  readline.cursorTo(this!, x, y, callback)
                }
                ;(output as any).clearLine = function clearLine(
                  dir: Direction,
                  callback?: (() => void) | undefined
                ) {
                  readline.clearLine(this!, dir, callback)
                }
              }
              mutexFn(
                ipcColorLevel,
                hasInput ? (input as Readable) : undefined,
                hasOutput ? (output as Writable) : undefined
              )
                .then(resolve, reject)
                .finally(() => {
                  conn.unref()
                  conn.end()
                  input?.end()
                  output?.end()
                  // process.exit(13)
                })
            }
          } catch (e: any) {
            reject(e as Error)
          }
        })
      })
    }
  }
}

function createIPCServer(
  colorLevel: ColorSupportLevel,
  captureState: CaptureState,
  npmlog: typeof import('npmlog')
): Promise<Server> {
  const input = process.stdin
  const output = process.stderr
  return new Promise((resolve, reject) => {
    const server = net
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      .createServer(async conn => {
        if (captureState.captured) {
          await new Promise<void>(resolve => {
            captureState.pendingCaptures.push({
              resolve() {
                resolve()
              }
            })
          })
        } else {
          captureState.captured = true
        }
        const wasProgressEnabled = (<unknown>npmlog.progressEnabled) as boolean
        npmlog.pause()
        if (wasProgressEnabled) {
          npmlog.disableProgress()
        }
        conn.write(
          `${JSON.stringify({
            ipc_version,
            capabilities: {
              input: Boolean(input),
              output: true,
              colorLevel
            }
          })}\n`
        )
        conn
          .on('data', (data: Uint8Array) => {
            output.write(data)
          })
          .on('error', (e: any) => {
            output.write(
              `there was an error prompting from a sub shell (${e?.message}), socket npm closing`
            )
            process.exit(1)
          })
        input
          .on('data', (data: string | Uint8Array) => {
            conn.write(data)
          })
          .on('end', () => {
            conn.unref()
            conn.end()
            if (wasProgressEnabled) {
              npmlog.enableProgress()
            }
            npmlog.resume()
            captureState.nextCapture()
          })
      })
      .listen(sock, () => resolve(server))
      .on('error', reject)
      .unref()

    process.on('exit', () => {
      server.close()
      tryUnlinkSync(sock)
    })
    resolve(server)
  })
}

function createStandardTTYServer(
  colorLevel: ColorSupportLevel,
  isInteractive: boolean,
  npmlog: typeof import('npmlog')
): TTYSeverResult {
  const captureState: CaptureState = {
    captured: false,
    nextCapture: () => {
      if (captureState.pendingCaptures.length > 0) {
        const pendingCapture = captureState.pendingCaptures.shift()
        pendingCapture?.resolve()
      } else {
        captureState.captured = false
      }
    },
    pendingCaptures: []
  }

  tryUnlinkSync(sock)

  const input = isInteractive ? process.stdin : undefined
  const output = process.stderr

  let ipcServerPromise: Promise<Server> | undefined
  if (input) {
    ipcServerPromise = createIPCServer(colorLevel, captureState, npmlog)
  }
  return {
    async captureTTY(mutexFn) {
      await ipcServerPromise
      if (captureState.captured) {
        const captured = new Promise<void>(resolve => {
          captureState.pendingCaptures.push({
            resolve() {
              resolve()
            }
          })
        })
        await captured
      } else {
        captureState.captured = true
      }
      const wasProgressEnabled = (<unknown>npmlog.progressEnabled) as boolean
      try {
        npmlog.pause()
        if (wasProgressEnabled) {
          npmlog.disableProgress()
        }
        return await mutexFn(colorLevel, input, output)
      } finally {
        if (wasProgressEnabled) {
          npmlog.enableProgress()
        }
        npmlog.resume()
        captureState.nextCapture()
      }
    }
  }
}

function tryUnlinkSync(filepath: string) {
  try {
    unlinkSync(filepath)
  } catch (e: any) {
    if (isErrnoException(e) && e.code !== 'ENOENT') {
      throw e
    }
  }
}

export function createTTYServer(
  colorLevel: ColorSupportLevel,
  isInteractive: boolean,
  npmlog: any
): TTYSeverResult {
  return !isInteractive && TTY_IPC
    ? createNonStandardTTYServer()
    : createStandardTTYServer(colorLevel, isInteractive, npmlog)
}
