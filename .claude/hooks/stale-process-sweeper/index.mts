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
//   - Socket Firewall wrappers (`~/.socket/sfw/bin/sfw`) — each pnpm /
//     yarn invocation goes through one, and the wrapper sometimes
//     outlives its pnpm child. On a busy day this can pile up to
//     hundreds of orphans holding ~200MB RSS each (20+GB total).
//     Only orphans are reaped (parent dead or init) — live-parent
//     wrappers might be tied to an in-progress install.
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
  // Matches both shapes:
  //   - `node ... vitest/dist/cli ... run`         (older entry point)
  //   - `node ... vitest/dist/node.mjs ... run`    (alternate entry point)
  //   - `node node_modules/.bin/../vitest/vitest.mjs run` (current shape
  //     spawned by `pnpm test` / `vitest run`)
  {
    name: 'vitest-runner',
    rx: /vitest\/(dist\/(cli|node)\.[mc]?js|vitest\.[mc]?js)\b/,
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
  // Socket Firewall command wrappers. Three deployment layouts:
  //   - ~/.socket/sfw/bin/sfw[-<version>]            (current dev install)
  //   - ~/.socket/_dlx/<hash>/sfw                    (planned: dlxBinary cache)
  //   - ${RUNNER_TEMP}/sfw-bin/sfw[.exe]             (CI runner install)
  // Path component is invariant across home prefixes (/Users/<u>/ vs
  // /home/<u>/). The CI path uses RUNNER_TEMP which varies per OS but
  // the trailing `/sfw-bin/sfw` is stable.
  //
  // Orphan-only (the parent-alive branch in sweep()) — a live-parent
  // sfw is likely a mid-flight pnpm/yarn install.
  {
    name: 'sfw-wrapper',
    rx: /(?:\.socket\/(?:_dlx\/[0-9a-f]+|sfw\/bin)|sfw-bin)\/sfw(?:-[\w.]+)?(?:\.exe)?\b/,
  },
]

interface ProcRow {
  command: string
  // Elapsed seconds since process started.
  elapsedSec: number
  pcpu: number
  pid: number
  ppid: number
  rss: number
}

// Convert ps `etime` field ([dd-]hh:mm:ss or mm:ss) to seconds.
// Examples: "05:23" → 323, "1:02:30" → 3750, "2-04:00:00" → 187200.
function parseEtime(etime: string): number {
  let rest = etime
  let days = 0
  const dashIdx = rest.indexOf('-')
  if (dashIdx !== -1) {
    days = Number.parseInt(rest.slice(0, dashIdx), 10) || 0
    rest = rest.slice(dashIdx + 1)
  }
  const parts = rest.split(':').map(p => Number.parseInt(p, 10) || 0)
  let hours = 0
  let mins = 0
  let secs = 0
  if (parts.length === 3) {
    ;[hours, mins, secs] = parts as [number, number, number]
  } else if (parts.length === 2) {
    ;[mins, secs] = parts as [number, number]
  } else if (parts.length === 1) {
    secs = parts[0] ?? 0
  }
  return days * 86400 + hours * 3600 + mins * 60 + secs
}

function listProcesses(): ProcRow[] {
  // -A: all processes, -o: custom format, no truncation. macOS + Linux
  // both support `pcpu` (instantaneous CPU%) and `etime` (elapsed time).
  // Windows isn't supported (Stop hook is unix-only in practice).
  const result = spawnSync(
    'ps',
    ['-A', '-o', 'pid=,ppid=,rss=,pcpu=,etime=,command='],
    { encoding: 'utf8' },
  )
  if (result.status !== 0 || !result.stdout) {
    return []
  }
  const rows: ProcRow[] = []
  // `ps -A` is unix-only (see comment above), so the output uses LF
  // line endings — no CRLF normalization needed here.
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) {
      continue
    }
    // Split into [pid, ppid, rss, pcpu, etime, ...command]. `command`
    // may contain arbitrary spaces, so re-join after the first five
    // fields. `pcpu` and `etime` are well-formed (no embedded space).
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6) {
      continue
    }
    const pid = Number.parseInt(parts[0]!, 10)
    const ppid = Number.parseInt(parts[1]!, 10)
    const rss = Number.parseInt(parts[2]!, 10)
    const pcpu = Number.parseFloat(parts[3]!)
    const elapsedSec = parseEtime(parts[4]!)
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
      continue
    }
    const command = parts.slice(5).join(' ')
    rows.push({
      pid,
      ppid,
      rss,
      pcpu: Number.isFinite(pcpu) ? pcpu : 0,
      elapsedSec,
      command,
    })
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

// Two reasons a matched worker should be reaped:
//  1. ORPHAN — parent is gone or is init (PID 1). Classic case: vitest
//     SIGINT'd, parent exited, workers re-parented to init.
//  2. STUCK — parent is alive but the worker has been running for a
//     long time, holding lots of memory, and burning CPU. Classic case:
//     vitest run timed out from inside Claude Code; the parent CLI
//     process is technically alive but unproductive, and its workers
//     spin forever consuming gigabytes. We sweep these even though the
//     parent's still around.
//
// Stuck-worker thresholds — conservative on purpose. A real, productive
// worker doesn't simultaneously hit all three: 5+ minutes of wallclock
// AND >50% CPU sustained AND >500MB RSS. Healthy parallel test runs
// finish well under 5 minutes per worker; CI workers that legitimately
// take longer don't run inside Claude Code's hook environment anyway.
const STUCK_MIN_ELAPSED_SEC = 300
const STUCK_MIN_PCPU = 50
const STUCK_MIN_RSS_KB = 500 * 1024

function sweep(): {
  killed: Array<{
    name: string
    pid: number
    reason: 'orphan' | 'stuck'
    rssMb: number
  }>
  skipped: number
} {
  const rows = listProcesses()
  const myPid = process.pid
  const myPpid = process.ppid
  const killed: Array<{
    name: string
    pid: number
    reason: 'orphan' | 'stuck'
    rssMb: number
  }> = []
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
    let reason: 'orphan' | 'stuck' | undefined
    if (row.ppid === 1 || !isAlive(row.ppid)) {
      reason = 'orphan'
    } else if (
      row.elapsedSec >= STUCK_MIN_ELAPSED_SEC &&
      row.pcpu >= STUCK_MIN_PCPU &&
      row.rss >= STUCK_MIN_RSS_KB
    ) {
      // Worker is matched, has a live parent, but is wedged: long
      // elapsed time + spinning CPU + heavy memory. This is the
      // user-reported case where vitest workers hung at 100% CPU /
      // 1+GB RSS while their parent CLI was technically alive.
      reason = 'stuck'
    }
    if (reason === undefined) {
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
        name,
        pid: row.pid,
        reason,
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
  let result: ReturnType<typeof sweep>
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
      .map(k => `${k.name}=${k.pid}(${k.rssMb}MB,${k.reason})`)
      .join(', ')
    process.stderr.write(
      `[stale-process-sweeper] reaped ${result.killed.length} stale ` +
        `worker(s), ~${totalMb}MB freed: ${breakdown}\n`,
    )
  }
  process.exit(0)
}

main()
