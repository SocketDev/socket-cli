import { spawn as spawnNative } from 'node:child_process'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  collectFirewallDescendants,
  hasFirewallControllingTerminal,
  readFirewallProcesses,
  signalFirewallDescendants,
  signalFirewallProcessGroup,
} from './child-processes.mts'

import type { StdioOptions } from 'node:child_process'
import type { FirewallProcessIdentity } from './child-processes.mts'
import type { FirewallEnvironment } from './environment.mts'

export interface FirewallChildResult {
  code: number | null
  signal: NodeJS.Signals | null
}

export async function spawnFirewallChild(config: {
  executable: string
  args: readonly string[]
  cwd?: string | undefined
  env: FirewallEnvironment
  stdio?: StdioOptions | undefined
  signal?: AbortSignal | undefined
}): Promise<FirewallChildResult> {
  const opts = { __proto__: null, ...config } as typeof config
  opts.signal?.throwIfAborted()
  const detached =
    process.platform !== 'win32' && !hasFirewallControllingTerminal()
  const child = spawnNative(opts.executable, [...opts.args], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: opts.stdio ?? 'inherit',
    detached,
    shell: false,
    windowsHide: false,
  })
  return await new Promise<FirewallChildResult>((resolve, reject) => {
    let escalation: ReturnType<typeof setTimeout> | undefined
    let polling: ReturnType<typeof setInterval> | undefined
    let settled = false
    let exited = false
    const descendants = new Map<number, FirewallProcessIdentity>()

    function discover(): void {
      if (!child.pid || exited) {
        return
      }
      for (const entry of collectFirewallDescendants(
        child.pid,
        readFirewallProcesses(),
      )) {
        descendants.set(entry.pid, entry)
      }
    }
    function signalTree(signal: NodeJS.Signals): void {
      if (!child.pid) {
        return
      }
      if (detached) {
        signalFirewallProcessGroup(child.pid, signal)
        return
      }
      if (process.platform === 'win32') {
        if (!exited) {
          try {
            const result = spawnSync(
              'taskkill',
              ['/pid', String(child.pid), '/T', '/F'],
              {
                stdio: 'ignore',
                timeout: 5000,
              },
            )
            if (result.error || result.status !== 0) {
              child.kill(signal)
            }
          } catch {
            child.kill(signal)
          }
        }
        return
      }
      discover()
      signalFirewallDescendants(descendants, signal)
      if (!exited) {
        child.kill(signal)
      }
    }
    function dispatchSignal(signal: NodeJS.Signals): void {
      try {
        signalTree(signal)
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    function stop(signal: NodeJS.Signals): void {
      if (settled) {
        return
      }
      dispatchSignal(signal)
      if (settled) {
        return
      }
      if (!escalation) {
        escalation = setTimeout(() => dispatchSignal('SIGKILL'), 5000)
        escalation.unref()
      }
    }
    function interrupt(): void {
      stop('SIGINT')
    }
    function terminate(): void {
      stop('SIGTERM')
    }
    function hangup(): void {
      stop('SIGHUP')
    }
    function cleanup(): void {
      settled = true
      if (escalation) {
        clearTimeout(escalation)
      }
      if (polling) {
        clearInterval(polling)
      }
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
      process.removeListener('SIGHUP', hangup)
      opts.signal?.removeEventListener('abort', terminate)
    }
    if (!detached && process.platform !== 'win32') {
      polling = setInterval(discover, 500)
      polling.unref()
    }
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    process.on('SIGHUP', hangup)
    opts.signal?.addEventListener('abort', terminate, { once: true })
    child.once('error', error => {
      cleanup()
      reject(error)
    })
    child.once('exit', () => {
      exited = true
      if (polling) {
        clearInterval(polling)
      }
      dispatchSignal('SIGKILL')
    })
    child.once('close', (code, signal) => {
      cleanup()
      resolve({ code, signal })
    })
    if (opts.signal?.aborted) {
      terminate()
    }
  })
}
