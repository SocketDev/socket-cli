#!/usr/bin/env node
// Claude Code PreToolUse hook — concurrent-cargo-build-guard.
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

import { spawnSync } from '@socketsecurity/lib-stable/spawn/spawn'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: string | undefined } | undefined
  readonly transcript_path?: string | undefined
}

const BYPASS_PHRASE = 'Allow concurrent-cargo-build bypass'

// Patterns that identify a release build invocation. Each entry is a regex
// matched against the command string AND a separate regex used by pgrep -f
// to find in-flight builds. The two can differ — the cmdline regex is more
// permissive (e.g. captures `pnpm` wrappers) while the pgrep regex targets
// the actual long-running cargo / linker process.
interface BuildPattern {
  readonly label: string
  readonly cmdRe: RegExp
  // pgrep -f pattern (string, not RegExp — pgrep uses POSIX ERE).
  readonly pgrepPattern: string
}

const BUILD_PATTERNS: BuildPattern[] = [
  {
    label: 'cargo build --release',
    cmdRe: /\bcargo\s+(?:b|build)\b[^&;|]*?(?:--release|\s-r\b)/,
    pgrepPattern: 'cargo (build|b).*(--release|-r)',
  },
  {
    label: 'pnpm build:prod',
    cmdRe: /\bpnpm\s+(?:run\s+)?build:prod\b/,
    pgrepPattern: 'pnpm.*build:prod',
  },
  {
    label: 'node scripts/build.mts --prod',
    cmdRe: /\bnode\s+(?:[^&;|]*\/)?scripts\/build\.mts\b[^&;|]*?--prod/,
    pgrepPattern: 'node.*scripts/build\\.mts.*--prod',
  },
]

export function commandMatchesBuild(command: string): BuildPattern | undefined {
  // Exempt cargo check + bare cargo build (no --release) explicitly.
  // The matching regex already requires --release / -r, so this is just
  // documentation — the false-positive surface is bounded.
  for (let i = 0, { length } = BUILD_PATTERNS; i < length; i += 1) {
    const p = BUILD_PATTERNS[i]!
    if (p.cmdRe.test(command)) {
      return p
    }
  }
  return undefined
}

export function countInFlight(pgrepPattern: string): number {
  const r = spawnSync('pgrep', ['-f', pgrepPattern], {
    timeout: 5_000,
  })
  if (r.status !== 0) {
    return 0
  }
  return String(r.stdout).split('\n').filter(Boolean).length
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw) {
    process.exit(0)
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command = payload.tool_input?.command ?? ''
  if (!command) {
    process.exit(0)
  }

  const matched = commandMatchesBuild(command)
  if (!matched) {
    process.exit(0)
  }

  const inFlight = countInFlight(matched.pgrepPattern)
  if (inFlight === 0) {
    process.exit(0)
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    process.exit(0)
  }

  process.stderr.write(
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
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(
    `[concurrent-cargo-build-guard] hook error (allowing): ${(e as Error).message}\n`,
  )
})
