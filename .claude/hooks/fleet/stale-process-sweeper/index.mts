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
//   - Socket Firewall wrappers (`~/.socket/_wheelhouse/bin/sfw`) — each pnpm /
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

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
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
  // Socket Firewall command wrappers. Deployment layouts seen in the wild:
  //   - ~/.socket/_wheelhouse/rack/sfw/<version>/sfw   (current: the readable
  //                                                     rack path both installers
  //                                                     expose — real binary for
  //                                                     setup-tools, a symlink to
  //                                                     the _dlx store for
  //                                                     install-sfw)
  //   - ~/.socket/_dlx/<hash>/sfw                      (dlxBinary store — the
  //                                                     real binary behind the
  //                                                     rack symlink)
  //   - ~/.socket/sfw/bin/sfw[-<version>]              (legacy versioned install)
  //   - ~/.socket/_wheelhouse/sfw-stable/sfw           (legacy shim exec target)
  //   - ~/.socket/_wheelhouse/bin/sfw[-<version>]      (legacy dev install)
  //   - ${RUNNER_TEMP}/sfw-bin/sfw[.exe]               (CI runner install)
  // Path component is invariant across home prefixes (/Users/<user>/ vs
  // /home/<user>/). The CI path uses RUNNER_TEMP which varies per OS but
  // the trailing `/sfw-bin/sfw` is stable.
  //
  // Orphan-only (the parent-alive branch in sweep()) — a live-parent
  // sfw is likely a mid-flight pnpm/yarn install. **Why:** 2026-06-02 the
  // regex only matched `sfw/bin`, so the shims' real exec target
  // (`_wheelhouse/sfw-stable/sfw`) leaked 44 orphaned probe processes
  // over ~7h before a manual reap. Keep this in sync with the shim
  // exec paths under ~/.socket/sfw/shims/.
  {
    name: 'sfw-wrapper',
    // Breakdown of the pattern below:
    //   (?:                          ── start: alternation of parent dirs
    //     \.socket\/                  literal ".socket/" (the install root)
    //     (?:                         ── one of these subtrees under .socket/
    //       _dlx\/[0-9a-f]+           "_dlx/<hex-hash>"  — dlxBinary store
    //       | sfw\/bin                "sfw/bin"          — legacy dev install
    //       | _wheelhouse\/           "_wheelhouse/" then one of…
    //         (?: bin                   "bin"            (legacy dev install)
    //           | rack\/sfw\/[\w.]+     "rack/sfw/<ver>" (current readable path)
    //           | sfw-stable )          "sfw-stable"     (legacy shim target)
    //     )
    //     | sfw-bin                   OR bare "sfw-bin"  — CI ${RUNNER_TEMP}/sfw-bin
    //   )
    //   \/sfw                         literal "/sfw" (the binary name)
    //   (?:-[\w.]+)?                  optional "-<version>" suffix (e.g. -1.12.0)
    //   (?:\.exe)?                    optional ".exe" (Windows)
    //   \b                            word boundary — don't match "sfwfoo"
    // Home prefix (/Users/<u>/ vs /home/<u>/) is intentionally NOT anchored;
    // the .socket/… path segment is the invariant. listProcesses() swaps
    // `\` → `/` in the command first, so this `/`-only pattern (incl. the
    // `.exe` branch) matches a future Windows process source too. Negative
    // cases: a plain "/Library/pnpm/pnpm" (no sfw wrapper) and editors/IDEs
    // never match.
    rx: /(?:\.socket\/(?:_dlx\/[0-9a-f]+|sfw\/bin|_wheelhouse\/(?:bin|rack\/sfw\/[\w.]+|sfw-stable))|sfw-bin)\/sfw(?:-[\w.]+)?(?:\.exe)?\b/,
  },
]

// Orphaned AI-agent processes — only swept in --all (explicit "kill
// everything") mode, AND only when orphaned (the sweep loop still
// requires reason 'forced' which --all only assigns; live-parented
// agents are never matched here because these patterns are consulted
// solely under --all and even then the orphan check is what makes them
// safe to kill). These are NEVER consulted by the Stop-hook default —
// reaping a sibling Claude/Codex session mid-turn would be catastrophic.
// Observed real leaks (12–19 days old, PPID 1) that motivated this:
//   - `claude doctor` invocations that detached and never exited
//   - codex-plugin app-server brokers + `codex app-server` children from
//     codex-plugin-test temp dirs that outlived their test run
//   - `bash -c … until [ -f …/tasks/<id>.output.exitcode ]; do sleep`
//     background-task pollers waiting on an exitcode file that never lands
const AGENT_PATTERNS: Array<{ name: string; rx: RegExp }> = [
  // Codex app-server + its broker (the noisiest leaker observed).
  {
    name: 'codex-app-server',
    rx: /\bcodex\b.*\bapp-server\b|app-server-broker\.[mc]?js\b/,
  },
  // `claude doctor` / other detached claude CLI invocations. Anchored on
  // a `claude` arg followed by a subcommand so it can't match an
  // arbitrary path containing "claude" (e.g. a project dir).
  {
    name: 'claude-cli',
    rx: /(?:^|\/|\s)claude\s+(?:doctor|update|mcp|migrate-installer)\b/,
  },
  // Orphaned Claude background-task pollers: a bash loop waiting on a
  // task .output.exitcode sentinel that will never appear once the
  // session that spawned it is gone.
  {
    name: 'claude-task-poller',
    rx: /tasks\/[A-Za-z0-9]+\.output\.exitcode\b/,
  },
]

// Processes the sweep must NEVER kill, in ANY mode (not even --all),
// checked before classify(). The token-minifier proxy is the live
// ANTHROPIC_BASE_URL backend the current session routes through; it runs
// detached (PPID 1) ON PURPOSE as a persistent daemon, so the orphan
// heuristic would otherwise make it a prime --all target. Killing it
// breaks the session that's running the sweep. Add any other
// session-critical daemon here.
const SESSION_CRITICAL_PATTERNS: RegExp[] = [
  // socket-token-minifier proxy: `node …/socket-token-minifier/bin/socket-token-minifier.mts`
  // (or a built .js). Match the package path so a rename of the entry
  // file still protects it.
  /socket-token-minifier\//,
]

export function isSessionCriticalDaemon(command: string): boolean {
  for (const rx of SESSION_CRITICAL_PATTERNS) {
    if (rx.test(command)) {
      return true
    }
  }
  return false
}

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
export function parseEtime(etime: string): number {
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

export function listProcesses(): ProcRow[] {
  // -A: all processes, -o: custom format, no truncation. macOS + Linux
  // both support `pcpu` (instantaneous CPU%) and `etime` (elapsed time).
  // Windows isn't supported (Stop hook is unix-only in practice).
  const result = spawnSync(
    'ps',
    ['-A', '-o', 'pid=,ppid=,rss=,pcpu=,etime=,command='],
    {},
  )
  if (result.status !== 0 || !result.stdout) {
    return []
  }
  const rows: ProcRow[] = []
  // `ps -A` is unix-only (see comment above), so the output uses LF
  // line endings — no CRLF normalization needed here.
  for (const line of String(result.stdout).split('\n')) {
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
    // Swap `\` → `/` so the STALE_PATTERNS regexes (written against `/`
    // only) match on every platform — see the fleet "cross-platform path
    // matching" rule. This is a SEPARATOR swap, not normalizePath(): the
    // string is a full command line (binary + args), and normalizePath
    // would apply path semantics to it — collapsing `..` inside an
    // argument (`node ../foo.mjs` → `node /foo.mjs`) and stripping
    // trailing slashes. A plain replace only touches separators, which is
    // all the substring regexes need. Today `ps -A` is unix-only so the
    // input already uses `/`; this keeps the regexes correct if a Windows
    // `tasklist`/`wmic` branch is ever added to listProcesses.
    const command = parts.slice(5).join(' ').replaceAll('\\', '/')
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

export function isAlive(pid: number): boolean {
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

export function classify(row: ProcRow): string | undefined {
  for (const { name, rx } of STALE_PATTERNS) {
    if (rx.test(row.command)) {
      return name
    }
  }
  return undefined
}

// Match orphaned AI-agent processes (AGENT_PATTERNS). Kept separate from
// classify() so the Stop-hook default never even considers these — only
// the explicit --all sweep calls it, and only kills the matches that are
// also orphaned. Returns the pattern name or undefined.
export function classifyAgent(row: ProcRow): string | undefined {
  for (const { name, rx } of AGENT_PATTERNS) {
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

export interface SweepOptions {
  // When true, kill EVERY classified process regardless of parent
  // liveness or the stuck-worker thresholds, with SIGKILL. This is the
  // explicit "stop all background processing" mode (the `kill` run
  // target / `--all` flag), NOT the conservative Stop-hook default which
  // spares healthy live-parent work.
  all?: boolean | undefined
}

export type SweepReason = 'orphan' | 'stuck' | 'forced'

export function sweep(options?: SweepOptions): {
  killed: Array<{
    name: string
    pid: number
    reason: SweepReason
    rssMb: number
  }>
  skipped: number
} {
  const all = options?.all === true
  const rows = listProcesses()
  const myPid = process.pid
  const myPpid = process.ppid
  const killed: Array<{
    name: string
    pid: number
    reason: SweepReason
    rssMb: number
  }> = []
  let skipped = 0

  for (let i = 0, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    // Never touch ourselves or our parent (Claude Code).
    if (row.pid === myPid || row.pid === myPpid) {
      continue
    }
    // Never touch a session-critical daemon (e.g. the token-minifier
    // proxy), even in --all — see SESSION_CRITICAL_PATTERNS.
    if (isSessionCriticalDaemon(row.command)) {
      continue
    }
    const isOrphan = row.ppid === 1 || !isAlive(row.ppid)
    // Build/test workers (STALE_PATTERNS) — the always-on set.
    const workerName = classify(row)
    // AI-agent processes (AGENT_PATTERNS) — only in --all, and only the
    // orphaned ones. A live-parented agent is a real session; never kill
    // it, even in --all.
    const agentName = all && isOrphan ? classifyAgent(row) : undefined
    const name = workerName ?? agentName
    if (!name) {
      continue
    }
    let reason: SweepReason | undefined
    if (agentName !== undefined && workerName === undefined) {
      // Orphaned agent matched only by AGENT_PATTERNS (already
      // orphan-gated above). Always 'forced' — we only got here under --all.
      reason = 'forced'
    } else if (all) {
      // Explicit kill-everything: any build/test worker qualifies,
      // including healthy live-parent work the Stop hook would spare.
      reason = 'forced'
    } else if (isOrphan) {
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
      // Stop-hook default sends SIGTERM (graceful — let the worker flush;
      // next turn's sweep SIGKILLs any straggler). --all sends SIGKILL
      // outright: it's an explicit "kill everything now" and shouldn't
      // depend on a follow-up sweep to finish the job.
      process.kill(row.pid, all ? 'SIGKILL' : 'SIGTERM')
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
  // `--all` / `--force`: explicit "kill all background processing + reap
  // orphans" mode. Invoked directly (the `kill` run target), not as a
  // Stop hook, so there's no stdin payload to drain — run immediately.
  const all = process.argv.includes('--all') || process.argv.includes('--force')
  if (all) {
    runSweep({ all: true })
    return
  }
  // Stop-hook path: drain stdin (the hook delivers a JSON payload). We
  // don't need the body, but Node will keep the event loop alive if we
  // don't consume it.
  process.stdin.resume()
  process.stdin.on('data', () => {})
  process.stdin.on('end', () => runSweep())
  // If stdin is already closed (some hook runners don't pipe input),
  // run immediately.
  if (process.stdin.readable === false) {
    runSweep()
  }
}

export function runSweep(options?: SweepOptions) {
  let result: ReturnType<typeof sweep>
  try {
    result = sweep(options)
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
  } else if (options?.all) {
    // In explicit kill mode, confirm the no-op so the user isn't left
    // wondering whether anything ran.
    process.stderr.write('[stale-process-sweeper] nothing to reap\n')
  }
  process.exit(0)
}

// Entrypoint-guarded: run main() only when invoked directly, NOT when the test
// imports this module for its pure helpers (else main() blocks on stdin at
// import and the test file never terminates).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
