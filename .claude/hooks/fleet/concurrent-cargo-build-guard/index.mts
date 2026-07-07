#!/usr/bin/env node
// @socket-capability cargo
// Claude Code PreToolUse hook — concurrent-cargo-build-guard.
//
// Off-by-default fleet hook: the cascade installs it only into repos that
// declare `claude.capabilities: ["cargo"]` in socket-wheelhouse.json (the
// dir-mirror copy filter reads this `@socket-capability` header). Repos that
// don't build Rust never receive it.
//
// Blocks Bash invocations of `cargo build --release` (or known fleet
// build-prod aliases) when another release build is already in flight.
// Each cargo release build spawns 8 LLVM threads using 8-22GB RAM;
// concurrent builds OOM-kill on typical dev machines.
//
// Detection model:
//   - Fires on Bash invocations of `cargo build --release` / `cargo build -r`
//     / `cargo b --release` / `pnpm build:prod` / `node scripts/build.mts --prod`
//     (extend the pattern list when more aliases land).
//   - Probes for an in-flight build via `pgrep -f` on the same patterns. If
//     count ≥ 1, block.
//   - Cargo `check` / dev builds are explicitly exempt (fast + parallel-safe).
//
// Bypass: `Allow concurrent-cargo-build bypass` typed verbatim in a recent
// user turn.
//
// Fires only on cargo / build-prod commands, so a no-op in repos that
// don't use cargo.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow concurrent-cargo-build bypass'

// Patterns that identify a release build invocation. Each entry is a regex
// matched against the command string AND a separate regex used by pgrep -f
// to find in-flight builds. The two can differ — the cmdline regex is more
// permissive (e.g. captures `pnpm` wrappers) while the pgrep regex targets
// the actual long-running cargo / linker process.
interface BuildPattern {
  readonly label: string
  // Parser-based matcher: true when `command` invokes this release build.
  readonly matches: (command: string) => boolean
  // pgrep -f pattern (string, not RegExp — pgrep uses POSIX ERE).
  readonly pgrepPattern: string
}

const BUILD_PATTERNS: BuildPattern[] = [
  {
    label: 'cargo build --release',
    // `cargo` (or `cargo b`/`build`) with a release flag, as a real
    // command — not the words appearing in a quoted string or a sibling.
    matches: command =>
      commandsFor(command, 'cargo').some(
        c =>
          (c.args.includes('build') || c.args.includes('b')) &&
          (c.args.includes('--release') || c.args.includes('-r')),
      ),
    pgrepPattern: 'cargo (build|b).*(--release|-r)',
  },
  {
    label: 'pnpm build:prod',
    // `pnpm build:prod` or `pnpm run build:prod` — the script token shows
    // up as an arg either way.
    matches: command =>
      commandsFor(command, 'pnpm').some(c => c.args.includes('build:prod')),
    pgrepPattern: 'pnpm.*build:prod',
  },
  {
    label: 'node scripts/build.mts --prod',
    // `node …/scripts/build.mts --prod` — the script path is an arg ending
    // in scripts/build.mts and --prod is a flag on the same node command.
    matches: command =>
      commandsFor(command, 'node').some(
        c =>
          c.args.some(a => /(?:^|\/)scripts\/build\.mts$/.test(a)) &&
          c.args.includes('--prod'),
      ),
    pgrepPattern: 'node.*scripts/build\\.mts.*--prod',
  },
]

export function commandMatchesBuild(command: string): BuildPattern | undefined {
  for (let i = 0, { length } = BUILD_PATTERNS; i < length; i += 1) {
    const p = BUILD_PATTERNS[i]!
    if (p.matches(command)) {
      return p
    }
  }
  return undefined
}

export function countInFlight(pgrepPattern: string): number {
  const r = spawnSync('pgrep', ['-f', pgrepPattern], {
    timeout: 5000,
  })
  if (r.status !== 0) {
    return 0
  }
  return String(r.stdout).split('\n').filter(Boolean).length
}

export const check = bashGuard((command, payload) => {
  const matched = commandMatchesBuild(command)
  if (!matched) {
    return undefined
  }

  const inFlight = countInFlight(matched.pgrepPattern)
  if (inFlight === 0) {
    return undefined
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }

  return block(
    [
      '[concurrent-cargo-build-guard] Blocked: release build already in flight',
      '',
      `  Requested: ${matched.label}`,
      `  In-flight: ${inFlight} matching process(es) via pgrep -f '${matched.pgrepPattern}'`,
      '',
      '  Each release build spawns 8 LLVM threads using 8-22GB RAM.',
      '  Running two simultaneously OOM-kills on typical dev machines.',
      '',
      '  Options:',
      '    - Wait for the in-flight build to finish.',
      '    - Run a dev build instead: `cargo build` (no --release) is',
      '      fast (~1-2s) and parallel-safe.',
      `    - Bypass: type "${BYPASS_PHRASE}" in a new message, then retry`,
      '      (use sparingly; OOM consequences are real).',
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
