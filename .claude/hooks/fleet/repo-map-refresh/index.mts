#!/usr/bin/env node
// Claude Code SessionStart hook — repo-map cache refresh.
//
// Keeps the on-disk repo-map cache (.repo-map/<rel>.skel) warm so the
// read-orientation-nudge hook can point a model straight at a ready-made,
// ~95%-smaller skeleton instead of a whole-file read (context re-read dominates
// spend). Runs the CHEAP incremental refresh — `make-repo-map --write
// --changed` — which only re-skeletons git-touched source files.
//
// Deliberately INCREMENTAL, not a full build: it only fires when `.repo-map/`
// already exists (seeded by the `refresh-repo-map` workflow or a prior run), so
// a fresh clone never pays a heavy first-build at session start. When the cache
// is absent the hook no-ops and read-orientation-nudge simply falls back to
// suggesting a `--write` generate.
//
// **Fail-open**: spawned DETACHED + unref'd with stdio ignored, so it adds zero
// session latency and any error (no git, missing script, spawn failure) is
// swallowed — the session proceeds with a possibly-staler cache, never a break.

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isHookEntrypoint } from '../_shared/entrypoint.mts'

const logger = getDefaultLogger()

const REPO_MAP_DIR = '.repo-map'
const MAKE_REPO_MAP = 'scripts/fleet/make-repo-map.mts'

/**
 * Spawn `node make-repo-map.mts --write --changed` detached from the repo root.
 * unref'd so it survives this hook's exit and never holds the SessionStart
 * chain; stdio ignored so a refresh log never leaks into session output.
 */
/* c8 ignore start - spawnRefresh runs the real generator in a child; requires the script on disk + a git repo, and is only called from the c8-ignored main() */
export function spawnRefresh(repoRoot: string): void {
  const result = spawn(
    process.execPath,
    [path.join(repoRoot, MAKE_REPO_MAP), '--write', '--changed'],
    { cwd: repoRoot, detached: true, stdio: 'ignore' },
  )
  // Best-effort: swallow the spawn promise rejection (missing binary / script)
  // so a failure fails OPEN instead of crashing the SessionStart hook.
  result.catch(() => undefined)
  result.process.unref()
}
/* c8 ignore stop */

/**
 * Whether an incremental refresh should run for `repoRoot`: the cache dir must
 * already exist (incremental-only — a fresh clone is seeded by the
 * `refresh-repo-map` workflow, not at session start) AND the generator script
 * must be present. Pure over the filesystem so it unit-tests with temp dirs.
 */
export function shouldRefresh(repoRoot: string): boolean {
  return (
    existsSync(path.join(repoRoot, REPO_MAP_DIR)) &&
    existsSync(path.join(repoRoot, MAKE_REPO_MAP))
  )
}

/* c8 ignore start - main() depends on real machine state: CLAUDE_PROJECT_DIR + a detached spawn */
function main(): void {
  const repoRoot = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  if (shouldRefresh(repoRoot)) {
    spawnRefresh(repoRoot)
  }
}
/* c8 ignore stop */

// Entrypoint-guarded so the test can import spawnRefresh without firing main().
/* c8 ignore next - entrypoint guard only fires when the script is run directly */
if (isHookEntrypoint(import.meta.url)) {
  /* c8 ignore start - direct-invocation body only reachable when run as a CLI */
  try {
    main()
  } catch (e) {
    logger.fail(`repo-map-refresh hook error: ${String(e)}`)
  }
  process.exit(0)
  /* c8 ignore stop */
}
