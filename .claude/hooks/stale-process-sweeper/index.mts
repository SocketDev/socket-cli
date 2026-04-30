#!/usr/bin/env node
// Claude Code Stop hook — stale-process-sweeper.
//
// Fires at turn-end. Finds Node test/build worker processes that the
// session left behind (test runner crashed mid-run, hook timed out,
// user interrupted `Bash`, etc.) and kills them so they don't pile up
// across turns and exhaust system memory.
//
// What's swept:
//   - vitest workers (`vitest/dist/workers/forks` and the threads pool)
//   - vitest itself (orphan parent runners that survived a SIGINT)
//   - tsgo / tsc type-check daemons
//   - type-coverage workers
//   - esbuild service processes
//
// What's NOT swept:
//   - Anything spawned by a still-living shell (PPID alive)
//   - Anything matching the user's editors / IDEs / terminals
//   - The Claude Code process itself
//
// The hook is fast (one `ps` call + a few regex matches + a couple of
// `kill -0` probes) and silent on the happy path. It only writes to
// stderr when it actually killed something — that's a useful signal.
//
// Stop hooks receive JSON on stdin (we don't read it; the body
// shape is irrelevant to our work) and exit code is advisory.

import { spawnSync } from 'node:child_process'
import process from 'node:process'

// Process-name patterns that indicate a stale test/build worker.
// Must be specific enough that real user processes (a normal `node`
// invocation, an editor's language server) don't match.
const STALE_PATTERNS: Array<{ name: string; rx: RegExp }> = [
  // Vitest worker pools — both `forks` (process-per-worker) and the
  // path the threads pool uses when isolation is requested. The
  // canonical leak: Vitest spawns N workers, parent crashes/SIGINTs,
  // workers stay alive holding 80–100MB each.
  {
    name: 'vitest-worker',
    rx: /vitest\/dist\/workers\/(forks|threads)/,
  },
  // Vitest parent runner that survived its own children's exit.
  // Matches `node ... vitest/dist/cli ... run` etc.
  {
    name: 'vitest-runner',
    rx: /vitest\/dist\/(cli|node)\.[mc]?js/,
  },
  // tsgo / tsc daemons. `tsgo` is the new Go-based type checker;
  // `tsc --watch` daemons can also linger.
  {
    name: 'tsgo',
    rx: /\btsgo\b/,
  },
  // type-coverage runs as a separate process and sometimes outlives
  // its CI step.
  {
    name: 'type-coverage',
    rx: /type-coverage\/bin\/type-coverage/,
  },
  // esbuild's daemon service helper.
  {
    name: 'esbuild-service',
    rx: /esbuild\/(bin|lib)\/.*\bservice\b/,
  },
]

interface ProcRow {
  pid: number
  ppid: number
  rss: number
  command: string
}

function listProcesses(): ProcRow[] {
  // -A: all processes, -o: custom format, no truncation. macOS + Linux
  // both support this exact form. Windows isn't supported (Stop hook
  // is unix-only in practice for socket-* repos).
  const result = spawnSync(
    'ps',
    ['-A', '-o', 'pid=,ppid=,rss=,command='],
    { encoding: 'utf8' },
  )
  if (result.status !== 0 || !result.stdout) {
    return []
  }
  const rows: ProcRow[] = []
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) {
      continue
    }
    // Split into [pid, ppid, rss, ...command]. `command` may contain
    // arbitrary spaces, so re-join after the first three fields.
    const parts = line.trim().split(/\s+/)
    if (parts.length < 4) {
      continue
    }
    const pid = Number.parseInt(parts[0]!, 10)
    const ppid = Number.parseInt(parts[1]!, 10)
    const rss = Number.parseInt(parts[2]!, 10)
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
      continue
    }
    const command = parts.slice(3).join(' ')
    rows.push({ pid, ppid, rss, command })
  }
  return rows
}

function isAlive(pid: number): boolean {
  if (pid <= 1) {
    // PID 0 / 1 are the kernel / init — if our parent is one of those,
    // we're definitely an orphan, but `kill -0 1` would mislead.
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function classify(row: ProcRow): string | undefined {
  for (const { name, rx } of STALE_PATTERNS) {
    if (rx.test(row.command)) {
      return name
    }
  }
  return undefined
}

function sweep(): { killed: Array<{ pid: number; name: string; rssMb: number }>; skipped: number } {
  const rows = listProcesses()
  const myPid = process.pid
  const myPpid = process.ppid
  const killed: Array<{ pid: number; name: string; rssMb: number }> = []
  let skipped = 0

  for (const row of rows) {
    // Never touch ourselves or our parent (Claude Code).
    if (row.pid === myPid || row.pid === myPpid) {
      continue
    }
    const name = classify(row)
    if (!name) {
      continue
    }
    // Only sweep if the parent is gone (true orphan) or is PID 1
    // (re-parented to init after the original parent exited). A live
    // parent means the worker is part of a real, in-progress run we
    // should not interrupt.
    const orphan = row.ppid === 1 || !isAlive(row.ppid)
    if (!orphan) {
      skipped += 1
      continue
    }
    try {
      // SIGTERM first — give the worker a chance to flush. We don't
      // wait for it; the next sweep (next turn) will SIGKILL anything
      // that ignored SIGTERM. Keeping the hook fast matters more than
      // squeezing every last byte.
      process.kill(row.pid, 'SIGTERM')
      killed.push({
        pid: row.pid,
        name,
        rssMb: Math.round(row.rss / 1024),
      })
    } catch {
      // Already gone, or we lack permission — nothing to do.
    }
  }
  return { killed, skipped }
}

function main() {
  // Drain stdin (Stop hook delivers a JSON payload). We don't need
  // the body, but Node will keep the event loop alive if we don't
  // consume it.
  process.stdin.resume()
  process.stdin.on('data', () => {})
  process.stdin.on('end', runSweep)
  // If stdin is already closed (some hook runners don't pipe input),
  // run immediately.
  if (process.stdin.readable === false) {
    runSweep()
  }
}

function runSweep() {
  let result: { killed: Array<{ pid: number; name: string; rssMb: number }>; skipped: number }
  try {
    result = sweep()
  } catch (e) {
    // Hooks must never crash a Claude turn. Log and exit clean.
    process.stderr.write(
      `[stale-process-sweeper] unexpected error: ${(e as Error).message}\n`,
    )
    process.exit(0)
  }
  if (result.killed.length > 0) {
    const totalMb = result.killed.reduce((sum, k) => sum + k.rssMb, 0)
    const breakdown = result.killed
      .map(k => `${k.name}=${k.pid}(${k.rssMb}MB)`)
      .join(', ')
    process.stderr.write(
      `[stale-process-sweeper] reaped ${result.killed.length} stale ` +
        `worker(s), ~${totalMb}MB freed: ${breakdown}\n`,
    )
  }
  process.exit(0)
}

main()
