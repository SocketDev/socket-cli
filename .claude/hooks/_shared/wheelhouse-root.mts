/**
 * @fileoverview Locate socket-wheelhouse's source-of-truth tree from
 * any fleet repo session.
 *
 * Hooks that enforce wheelhouse-level invariants (e.g.
 * new-hook-claude-md-guard ensuring every fleet hook has a CLAUDE.md
 * citation) need to read `template/CLAUDE.md` — the canonical fleet
 * block — regardless of which session the assistant is operating
 * from. CLAUDE_PROJECT_DIR points at the *session's* project; that's
 * socket-cli most of the time, not socket-wheelhouse.
 *
 * Resolution order:
 *   1. The session's project dir IS socket-wheelhouse.
 *   2. A sibling directory named `socket-wheelhouse` at `../`.
 *   3. A grandparent layout (worktrees): `../../socket-wheelhouse`.
 *   4. `$HOME/projects/socket-wheelhouse` — the documented fleet
 *      checkout layout.
 *   5. `$SOCKET_WHEELHOUSE_DIR` env override — escape hatch for
 *      non-standard layouts.
 *
 * Returns the absolute path to the wheelhouse repo root (the dir
 * containing `template/`), or `undefined` when none of the lookups
 * resolves. Callers should fail-open on undefined (the hook can't
 * enforce a rule it can't read).
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * Test whether `dir` is a socket-wheelhouse checkout. Looks for the
 * `template/CLAUDE.md` byte-canonical marker — every wheelhouse has
 * this file, downstream repos don't.
 */
function isWheelhouseRoot(dir: string): boolean {
  if (!existsSync(dir)) {
    return false
  }
  return existsSync(path.join(dir, 'template', 'CLAUDE.md'))
}

/**
 * Walk the candidate list and return the first hit. Cheap — at most
 * 5 file-stat probes, all on local disk.
 */
export function findWheelhouseRoot(
  options: { startDir?: string | undefined } = {},
): string | undefined {
  const startDir =
    options.startDir ?? process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()

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
    path.join(homedir(), 'projects', 'socket-wheelhouse'),
  ]

  for (const candidate of candidates) {
    if (isWheelhouseRoot(candidate)) {
      return path.resolve(candidate)
    }
  }
  return undefined
}

/**
 * Convenience: return the path to `template/CLAUDE.md` if the
 * wheelhouse can be located, else undefined.
 */
export function findWheelhouseTemplateClaudeMd(
  options: { startDir?: string | undefined } = {},
): string | undefined {
  const root = findWheelhouseRoot(options)
  if (!root) {
    return undefined
  }
  return path.join(root, 'template', 'CLAUDE.md')
}
