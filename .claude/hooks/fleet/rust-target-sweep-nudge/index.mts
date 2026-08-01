#!/usr/bin/env node
// Claude Code PostToolUse hook — rust-target-sweep-nudge.
//
// After a Bash command that ran `cargo`, check whether the repo the command
// acted on carries a cargo `target/` build dir. If it does, surface the
// janitor: `node scripts/fleet/rust-target-sweep.mts . --fix`.
//
// Why: cargo target/ dirs are the quiet disk killers. Every Rust checkout
// accumulates multi-GB debug+release artifacts, nothing ever cleans them,
// and the 2026-07-31 incident found ~100 GB of stale target/ dirs across
// ~16 checkouts on a machine down to 127 MB free. Everything in target/ is
// regenerable by `cargo build`, so the sweep is pure recovery — an agent
// that "visits a Rust repo and does things" should leave knowing the
// janitor exists and the exact command to run.
//
// This hook detects:
//   1. PostToolUse Bash calls
//   2. Whose command ran `cargo` (build/test/run/check — the operations that
//      grow target/)
//   3. AND the acted-on repo has a Cargo.toml with a target/ dir present
//
// On match it returns a non-blocking notify naming the sweep command. It
// does NOT sweep itself: a fresh target/ is the next build's cache, deleting
// it mid-session costs the operator a full rebuild, and the sweep script's
// staleness window (7 days by default) is the right judge — not a hook
// firing seconds after a build. Never blocks (notify, exit 0).

import { existsSync } from 'node:fs'
import path from 'node:path'

import { actedOnPath } from '../_shared/fleet-context.mts'
import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// The one binary that grows target/. rustc invocations outside cargo are
// rare enough (and produce no target/) that cargo is the whole trigger set.
const TRIGGER_BINARY = 'cargo'

export function commandRunsCargo(command: string): boolean {
  return commandsFor(command, TRIGGER_BINARY).length > 0
}

/**
 * The repo's target/ dir when this is a Rust checkout that has one, else
 * undefined. The filesystem probe is injectable so tests never touch a real
 * tree.
 */
export function cargoTargetOf(
  repoDir: string,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const target = path.join(repoDir, 'target')
  return exists(path.join(repoDir, 'Cargo.toml')) && exists(target)
    ? target
    : undefined
}

export function formatSweepNudge(targetDir: string): string {
  const lines: string[] = []
  lines.push('')
  lines.push('ℹ rust-target-sweep-nudge')
  lines.push('')
  lines.push(`\`${targetDir}\` exists — cargo build dirs are the quiet disk`)
  lines.push('killers (a 2026-07-31 sweep recovered ~100 GB of stale ones).')
  lines.push('Everything in target/ is regenerable, so when the work here is')
  lines.push('done, run the janitor:')
  lines.push('')
  lines.push('  node scripts/fleet/rust-target-sweep.mts . --fix')
  lines.push('')
  lines.push('It only deletes target/ dirs idle past the staleness window')
  lines.push('(default 7 days), so an actively rebuilt tree is left alone.')
  lines.push('Wider passes: `--fleet` (roster checkouts) or `--projects`')
  lines.push('(every Cargo.toml sibling, which catches non-fleet Rust repos).')
  lines.push('')
  return lines.join('\n')
}

export function getRepoDir(payload: ToolCallPayload): string | undefined {
  // The repo the command ACTS on — a `cd <sibling> && cargo build` grows that
  // repo's target/, not the session repo's.
  return actedOnPath(payload) || resolveProjectDir()
}

export const check = bashGuard((command, payload) => {
  if (!commandRunsCargo(command)) {
    return undefined
  }
  const repoDir = getRepoDir(payload)
  /* c8 ignore next - getRepoDir falls back to resolveProjectDir(), always non-empty */
  if (!repoDir) {
    return undefined
  }
  const target = cargoTargetOf(repoDir)
  if (!target) {
    return undefined
  }
  return notify(formatSweepNudge(target))
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
