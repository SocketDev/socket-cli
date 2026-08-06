#!/usr/bin/env node
// Claude Code SessionStart hook — repo-map cache refresh.
//
// Keeps the on-disk repo-map cache (.repo-map/<rel>.skel) warm so the
// read-orientation-nudge hook can point a model straight at a ready-made,
// ~95%-smaller skeleton instead of a whole-file read (context re-read dominates
// spend). Runs the CHEAP incremental refresh — `gen/repo-map --write
// --changed` — which only re-skeletons git-touched source files.
//
// Cold caches SEED, warm caches refresh: when `.repo-map/` already exists the
// hook runs the cheap incremental `--changed` pass; when it is absent it runs
// the full first build instead. Both spawn detached, so neither costs the
// session anything — the incremental-only design left every fleet member's
// cache permanently cold, because nothing else ever performed the first build
// (audited 2026-08-05: 12/12 members had the machinery wired and a cold cache).
//
// **Fail-open**: spawned DETACHED + unref'd with stdio ignored, so it adds zero
// session latency and any error, no git, missing script, spawn failure, is
// swallowed — the session proceeds with a possibly-staler cache, never a break.

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { defineHook, runHook } from '../_shared/guard.mts'

const REPO_MAP_DIR = '.repo-map'
const GEN_REPO_MAP = 'scripts/fleet/gen/repo-map.mts'

// This hook lives at `.claude/hooks/fleet/repo-map-refresh/index.mts`, so its
// own location is four levels below the project root — used only as the
// last-resort fallback when the agent runner hasn't set CLAUDE_PROJECT_DIR.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = path.join(HERE, '..', '..', '..', '..')

/**
 * Spawn `node gen/repo-map.mts --write [...args]` detached from the repo root.
 * unref'd so it survives this hook's exit and never holds the SessionStart
 * chain; stdio ignored so a refresh log never leaks into session output.
 */
/* c8 ignore start - spawnRefresh runs the real generator in a child; requires the script on disk + a git repo, and is only called from the c8-ignored main() */
export function spawnRefresh(repoRoot: string, args: readonly string[]): void {
  const result = spawn(
    process.execPath,
    [path.join(repoRoot, GEN_REPO_MAP), '--write', ...args],
    { cwd: repoRoot, detached: true, stdio: 'ignore' },
  )
  // Best-effort: swallow the spawn promise rejection (missing binary / script)
  // so a failure fails OPEN instead of crashing the SessionStart hook.
  result.catch(() => undefined)
  result.process.unref()
}
/* c8 ignore stop */

/**
 * The generator arguments for `repoRoot`, or undefined when no run should
 * happen (generator script absent). A warm cache gets the cheap incremental
 * `--changed` pass; a cold cache gets the full first build — both detached,
 * so the cold seed still costs the session nothing. Pure over the filesystem
 * so it unit-tests with temp dirs.
 */
export function refreshArgs(repoRoot: string): readonly string[] | undefined {
  if (!existsSync(path.join(repoRoot, GEN_REPO_MAP))) {
    return undefined
  }
  return existsSync(path.join(repoRoot, REPO_MAP_DIR)) ? ['--changed'] : []
}

export const hook = defineHook({
  /* c8 ignore start - check() depends on real machine state: CLAUDE_PROJECT_DIR + a detached spawn */
  check: async () => {
    const repoRoot = process.env['CLAUDE_PROJECT_DIR'] ?? DEFAULT_REPO_ROOT
    const args = refreshArgs(repoRoot)
    if (args) {
      spawnRefresh(repoRoot, args)
    }
    return undefined
  },
  /* c8 ignore stop */
  event: 'SessionStart',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
