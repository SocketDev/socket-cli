import { closeSync, constants, openSync } from 'node:fs'
import tty from 'node:tty'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

export function collectFirewallDescendants(
  pid: number,
  processes: FirewallProcessIdentity[],
): FirewallProcessIdentity[] {
  const parents = new Set([pid])
  const descendants: FirewallProcessIdentity[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0, { length } = processes; i < length; i += 1) {
      const entry = processes[i]!
      if (
        entry.pid !== process.pid &&
        !parents.has(entry.pid) &&
        parents.has(entry.parent)
      ) {
        parents.add(entry.pid)
        descendants.push(entry)
        changed = true
      }
    }
  }
  return descendants
}

export type FirewallProcessIdentity = {
  pid: number
  parent: number
  started: string
}

export function hasFirewallControllingTerminal(): boolean {
  let descriptor: number | undefined
  try {
    descriptor = openSync('/dev/tty', constants.O_RDONLY | constants.O_NONBLOCK)
    return tty.isatty(descriptor)
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor)
    }
  }
}

export function isFirewallProcessGroupInactive(pid: number): boolean {
  try {
    const result = spawnSync('/bin/ps', ['-axo', 'pgid=,stat='], {
      encoding: 'utf8',
      timeout: 5000,
    })
    if (result.status !== 0 || !result.stdout?.trim()) {
      return false
    }
    const rows = result.stdout.trim().split(/\r?\n/)
    for (let i = 0, { length } = rows; i < length; i += 1) {
      const row = rows[i]!
      // Parse the numeric process group and ps state letters with flag suffixes.
      const match = /^\s*(\d+)\s+([A-Za-z+<>NLslWX-]+)\s*$/.exec(row)
      if (!match) {
        return false
      }
      if (Number(match[1]) === pid && !match[2]!.startsWith('Z')) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

export function readFirewallProcesses(): FirewallProcessIdentity[] {
  try {
    const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.error || result.status !== 0) {
      return []
    }
    const listing = result.stdout
    return listing.split(/\r?\n/).flatMap(line => {
      // Parse PID, parent PID, and the full process start timestamp.
      const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
      return match
        ? [
            {
              pid: Number(match[1]),
              parent: Number(match[2]),
              started: match[3]!,
            },
          ]
        : []
    })
  } catch {
    return []
  }
}

export function signalFirewallDescendants(
  known: Map<number, FirewallProcessIdentity>,
  signal: NodeJS.Signals,
): void {
  const current = new Map(
    readFirewallProcesses().map(entry => [entry.pid, entry]),
  )
  const descendants = Array.from(known.values()).toReversed()
  for (let i = 0, { length } = descendants; i < length; i += 1) {
    const entry = descendants[i]!
    if (current.get(entry.pid)?.started === entry.started) {
      try {
        process.kill(entry.pid, signal)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          throw error
        }
      }
    }
  }
}

export function signalFirewallProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'EPERM' &&
      isFirewallProcessGroupInactive(pid)
    ) {
      return
    }
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error
    }
  }
}
