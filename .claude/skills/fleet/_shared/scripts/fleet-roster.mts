/**
 * Fleet roster reader for skill runners.
 *
 * The canonical fleet-repo list lives in ONE place — cascading-fleet/lib/
 * fleet-repos.txt — a newline-delimited file (blank lines + `#` comments
 * ignored). Four sibling skill libs (tidying-worktrees, tidying-files,
 * tidying-rolldown-bundles, auditing-api-surface) each re-declared their own
 * `FLEET_REPOS_FILE` path + `readRoster()`; cascading-fleet builds the path a
 * fifth way. That is five constructions of one path — a "1 path, 1 reference"
 * violation that drifts (one copy's error message, another's filter). This
 * module is the single owner: `FLEET_REPOS_FILE` is built once here, and every
 * consumer imports `readRoster()` instead of re-reading the file.
 *
 * The roster is a deliberate three-tier grouping (socket-* members
 * alphabetically, then the bare-prefix members sdxgen/stuie/ultrathink, then
 * socket-wheelhouse last). `readRoster()` preserves file order — it never
 * sorts — so the grouping survives.
 */

import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

/**
 * The canonical fleet roster file. Built exactly once, here. From
 * `_shared/scripts/` the roster is two levels up (to the `fleet/` skills root)
 * then into `cascading-fleet/lib/`.
 */
export const FLEET_REPOS_FILE = path.join(
  SCRIPT_DIR,
  '..',
  '..',
  'cascading-fleet',
  'lib',
  'fleet-repos.txt',
)

/**
 * Read the canonical fleet roster, preserving file order. Blank lines and
 * `#`-comment lines are dropped. Throws a fix-shaped error when the roster file
 * is absent (the skill tree is incomplete — re-cascade rather than hand-patch).
 */
export function readRoster(): string[] {
  if (!existsSync(FLEET_REPOS_FILE)) {
    throw new Error(
      `fleet roster not found at ${FLEET_REPOS_FILE}. The canonical list lives at cascading-fleet/lib/fleet-repos.txt; re-cascade the skill tree to restore it.`,
    )
  }
  return readFileSync(FLEET_REPOS_FILE, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const repo of readRoster()) {
    // Plain roster list to stdout; a logger prefix would corrupt it.
    process.stdout.write(`${repo}\n`) // socket-lint: allow
  }
}
