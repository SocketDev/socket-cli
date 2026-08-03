/*
 * @file Locate socket-wheelhouse's source-of-truth tree from any fleet repo
 *   session. Hooks that enforce wheelhouse-level invariants (e.g.
 *   new-hook-claude-md-guard ensuring every fleet hook has a CLAUDE.md
 *   citation) need to read `template/base/CLAUDE.md` — the canonical fleet block —
 *   regardless of which session the assistant is operating from.
 *   CLAUDE_PROJECT_DIR points at the _session's_ project; that's socket-cli
 *   most of the time, not socket-wheelhouse. Resolution order:
 *
 *   1. The session's project dir IS socket-wheelhouse.
 *   2. A sibling directory named `socket-wheelhouse` at `../`.
 *   3. A grandparent layout (worktrees): `../../socket-wheelhouse`.
 *   4. `$HOME/projects/socket-wheelhouse` — the documented fleet checkout layout.
 *   5. `$SOCKET_WHEELHOUSE_DIR` env override — escape hatch for non-standard
 *      layouts. Returns the absolute path to the wheelhouse repo root (the dir
 *      containing `template/`), or `undefined` when none of the lookups
 *      resolves. Callers should fail-open on undefined (the hook can't enforce
 *      a rule it can't read).
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveProjectDir } from './project-dir.mts'

/**
 * Walk the candidate list and return the first hit. Cheap — at most 5 file-stat
 * probes, all on local disk.
 */
export function findWheelhouseRoot(
  options: { startDir?: string | undefined } = {},
): string | undefined {
  const startDir = options.startDir ?? resolveProjectDir()

  // 1. Override via env var — used by CI / non-standard layouts.
  const envOverride = process.env['SOCKET_WHEELHOUSE_DIR']
  if (envOverride && isWheelhouseRoot(envOverride)) {
    return envOverride
  }

  const candidates: string[] = [
    // 2. The session's project dir IS the wheelhouse.
    startDir,
    // 3. A sibling repo named socket-wheelhouse.
    path.join(startDir, '..', 'socket-wheelhouse'),
    // 4. Worktree layout — wheelhouse is two levels up.
    path.join(startDir, '..', '..', 'socket-wheelhouse'),
    // 5. Documented fleet layout under $HOME.
    path.join(os.homedir(), 'projects', 'socket-wheelhouse'),
  ]

  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]!
    if (isWheelhouseRoot(candidate)) {
      return path.resolve(candidate)
    }
  }
  return undefined
}

/**
 * Convenience: return the path to `template/base/CLAUDE.md` (the canonical
 * fleet block) if the wheelhouse can be located, else undefined.
 */
export function findWheelhouseTemplateClaudeMd(
  options: { startDir?: string | undefined } = {},
): string | undefined {
  const root = findWheelhouseRoot(options)
  if (!root) {
    return undefined
  }
  return path.join(root, 'template', 'base', 'CLAUDE.md')
}

/**
 * Test whether `dir` is a socket-wheelhouse checkout. Looks for the
 * `template/base/CLAUDE.md` byte-canonical marker — every wheelhouse has this
 * file, downstream repos don't. (The canonical seed moved from `template/` to
 * `template/base/`; a stale `template/CLAUDE.md` probe here returned false for
 * the real wheelhouse, silently disabling every guard that locates the source.)
 */
export function isWheelhouseRoot(dir: string): boolean {
  if (!existsSync(dir)) {
    return false
  }
  return existsSync(path.join(dir, 'template', 'base', 'CLAUDE.md'))
}
