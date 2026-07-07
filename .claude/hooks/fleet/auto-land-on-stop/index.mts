#!/usr/bin/env node
// Claude Code Stop hook — auto-land-on-stop.
//
// Fires at turn-end. Groups THIS session's authored source changes into logical
// commits and lands them to local main, in EVERY repo the session touched
// (started in one repo, moved to another, both get their own commits). The
// fleet biases toward landing often: banked work survives compaction, and a
// clean tree is far less ambiguous to the next session's collision heuristics.
//
// Safety (own-work only; the pre-mortem's blocking flaws are all closed here +
// in land-work):
//   - Repos + paths come from the session touched-set (Edit/Write + git
//     add|mv|rm in the transcript), so a FOREIGN staged feature in the shared
//     index is never swept in. A repo the session only READ never enters.
//   - Each repo is landed by shelling the tested `scripts/fleet/land-work.mts
//     --commit <session-authored repo-relative paths>` with cwd=<repoRoot>. That
//     restricts to the passed paths AND skips generated / both-touched (concurrent
//     index+worktree, which a `git add` would blend) / unmerged-conflict paths,
//     and lands clean source even mid-rebase.
//   - Each commit passes that repo's own pre-commit gate (broken code caught).
//     The staged run is scoped `related` (not full-suite) so turn-end stays fast.
//   - Fail-open + deterministic: a per-repo spawn is bounded; any failure skips
//     that repo and the hook always exits cleanly (Stop hooks must not hang).
//   - Skipped entirely during a cascade (`FLEET_SYNC`) or a history squash
//     (`SQUASH_HISTORY`) — those own their own commits.
//
// A session that sees a commit it didn't personally issue should recognize it as
// this auto-lander (see docs/agents.md/fleet/parallel-claude-sessions.md ->
// "Auto-landed commits are expected"), not a rival — run `whose-work` to confirm.

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { readSessionTouchedPaths } from '../_shared/foreign-paths.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import {
  isParked,
  readParked,
  resolveParkedFile,
} from '../_shared/parked-paths.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// Per-repo land budget. land-work runs the repo's pre-commit per group; the
// staged run is scoped `related` (fast) so this rarely bites, but bound it so a
// wedged pre-commit can't hang the turn-end.
const LAND_TIMEOUT_MS = 120_000

function primaryDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

/**
 * The git top-level of a directory, or undefined when it isn't inside a repo.
 */
function gitToplevel(dir: string): string | undefined {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
    timeout: 5000,
  })
  if (r.status !== 0) {
    return undefined
  }
  return String(r.stdout ?? '').trim() || undefined
}

/**
 * Group absolute session-authored paths by their git repo root, mapping each to
 * the repo-relative paths under it. `resolveRoot` is injectable for tests.
 * Pure over its inputs (the resolver does the git I/O).
 */
export function groupByRepo(
  touchedAbs: readonly string[],
  resolveRoot: (dir: string) => string | undefined,
): Map<string, string[]> {
  const byRoot = new Map<string, string[]>()
  for (const abs of touchedAbs) {
    const root = resolveRoot(path.dirname(abs))
    if (!root) {
      continue
    }
    const rel = path.relative(root, abs)
    if (!rel || rel.startsWith('..')) {
      continue
    }
    const list = byRoot.get(root)
    if (list) {
      list.push(rel)
    } else {
      byRoot.set(root, [rel])
    }
  }
  return byRoot
}

export const check = (payload: ToolCallPayload): GuardResult => {
  // Cascade + history-squash own their own commits; never auto-land under them.
  if (process.env['FLEET_SYNC'] || process.env['SQUASH_HISTORY']) {
    return undefined
  }
  const allTouched = [...readSessionTouchedPaths(payload.transcript_path)]
  if (allTouched.length === 0) {
    return undefined
  }
  // User-intent HOLD (#238): paths the user parked (hold/park/wait, recorded
  // via hold.mts) are excluded from landing and surfaced instead.
  const parked = readParked(resolveParkedFile(primaryDir()), {
    now: Date.now(),
  })
  const held = parked.length
    ? allTouched.filter(abs => isParked(abs, parked))
    : []
  const touched = held.length
    ? allTouched.filter(abs => !isParked(abs, parked))
    : allTouched
  if (touched.length === 0) {
    return notify(
      `[auto-land-on-stop] nothing landed — all ${held.length} touched path(s) ` +
        'are parked by user hold. Clear via ' +
        'node .claude/hooks/fleet/auto-land-on-stop/hold.mts --clear <path…>.\n',
    )
  }
  const byRoot = groupByRepo(touched, dir => gitToplevel(dir))
  if (byRoot.size === 0) {
    return undefined
  }
  // land-work lives in the PRIMARY checkout; run it against each touched repo
  // via cwd (so a sibling needn't have its own copy yet).
  const landWork = path.join(primaryDir(), 'scripts', 'fleet', 'land-work.mts')
  if (!existsSync(landWork)) {
    return undefined
  }
  const landed: string[] = []
  for (const [root, rels] of byRoot) {
    const r = spawnSync('node', [landWork, '--commit', ...rels], {
      cwd: root,
      timeout: LAND_TIMEOUT_MS,
    })
    // Fail-open: a non-zero land (pre-commit refusal, nothing landable, wedged
    // gate) skips this repo silently; the next turn re-checks.
    if (r.status === 0 && /landed /.test(String(r.stdout ?? ''))) {
      landed.push(root)
    }
  }
  if (landed.length === 0) {
    return undefined
  }
  const lines = [
    `[auto-land-on-stop] landed this session's authored source in ${landed.length} repo(s):`,
    ...landed.map(r => `  ${r}`),
    'These are auto-lander commits (own-work only, surgical, gated). A session',
    'that sees them should recognize the auto-lander, not investigate a rival.',
  ]
  if (held.length > 0) {
    lines.push(
      `Held (parked by user, NOT landed): ${held.length} path(s) — clear via`,
      '  node .claude/hooks/fleet/auto-land-on-stop/hold.mts --clear <path…>',
    )
  }
  return notify(`${lines.join('\n')}\n`)
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
