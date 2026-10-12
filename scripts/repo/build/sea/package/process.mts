import { spawn as spawnChild } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

export type NativePackageProcessConfig = {
  cwd: string
  timeoutMs: number
  maxOutputBytes: number
}

export type NativePackageProcessResult = {
  code: number | null | undefined
  signal: NodeJS.Signals | null | undefined
  stdout: Buffer
  stderr: Buffer
  timedOut?: boolean | undefined
  outputLimitExceeded?: boolean | undefined
}

export type NativePackageSpawnProcess = (
  command: string,
  args: readonly string[],
  config: NativePackageProcessConfig,
) => Promise<NativePackageProcessResult>

function terminateNativePackageProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) {
    return new Promise(resolve => {
      let finished = false
      let stopping = false
      const finish = (): void => {
        if (finished) {
          return
        }
        finished = true
        if (timer) {
          clearTimeout(timer)
        }
        child.off('spawn', stopAfterSpawn)
        child.off('error', finish)
        resolve()
      }
      const stopAfterSpawn = (): void => {
        if (stopping) {
          return
        }
        stopping = true
        void terminateNativePackageProcessTree(child).then(finish, finish)
      }
      child.once('spawn', stopAfterSpawn)
      child.once('error', finish)
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish()
      }, 5000)
      if (child.pid !== undefined) {
        stopAfterSpawn()
      }
    })
  }
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
    return Promise.resolve()
  }
  return new Promise(resolve => {
    let finished = false
    const finish = (): void => {
      if (finished) {
        return
      }
      finished = true
      if (timer) {
        clearTimeout(timer)
      }
      resolve()
    }
    const terminator = spawnChild(
      'taskkill',
      ['/PID', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true },
    )
    const timer = setTimeout(() => {
      terminator.kill('SIGKILL')
      child.kill('SIGKILL')
      finish()
    }, 5000)
    terminator.once('error', () => {
      child.kill('SIGKILL')
      finish()
    })
    terminator.once('close', finish)
  })
}

export function spawnNativePackageProcess(
  command: string,
  args: readonly string[],
  config: NativePackageProcessConfig,
): Promise<NativePackageProcessResult> {
  const opts = { __proto__: null, ...config } as typeof config
  return new Promise((resolve, reject) => {
    const child = spawnChild(command, [...args], {
      cwd: opts.cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let capturedBytes = 0
    let outputLimitExceeded = false
    let timedOut = false
    let settled = false
    let failureKind: 'timeout' | 'output-limit' | undefined
    let termination: Promise<void> | undefined
    const settle = (result: NativePackageProcessResult): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      resolve(result)
    }
    const finishFailure = (): void => {
      if (settled || !failureKind) {
        return
      }
      settle({
        code: undefined,
        signal: undefined,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut: failureKind === 'timeout',
        outputLimitExceeded: failureKind === 'output-limit',
      })
    }
    const stopProcessTree = (kind: 'timeout' | 'output-limit'): void => {
      if (settled || failureKind) {
        return
      }
      failureKind = kind
      child.stdout?.destroy()
      child.stderr?.destroy()
      termination = terminateNativePackageProcessTree(child)
      void termination.then(finishFailure, finishFailure)
    }
    const capture = (chunks: Buffer[], chunk: Buffer): void => {
      if (failureKind) {
        return
      }
      const remaining = opts.maxOutputBytes - capturedBytes
      if (remaining > 0) {
        const saved = chunk.subarray(0, remaining)
        chunks.push(saved)
        capturedBytes += saved.length
      }
      if (chunk.length > remaining) {
        outputLimitExceeded = true
        stopProcessTree('output-limit')
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => capture(stdout, chunk))
    child.stderr?.on('data', (chunk: Buffer) => capture(stderr, chunk))
    child.once('error', error => {
      if (failureKind) {
        void termination?.then(finishFailure, finishFailure)
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      reject(error)
    })
    child.once('close', (code, signal) => {
      if (failureKind) {
        void termination?.then(finishFailure, finishFailure)
        return
      }
      settle({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut,
        outputLimitExceeded,
      })
    })
    const timer = setTimeout(() => {
      timedOut = true
      stopProcessTree('timeout')
    }, opts.timeoutMs)
    if (opts.timeoutMs <= 0) {
      stopProcessTree('timeout')
    }
  })
}
