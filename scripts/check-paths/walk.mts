/**
 * @fileoverview Repo file-walker for the path-hygiene gate.
 *
 * Recursively yields files under `dir` whose repo-relative path passes
 * `filter`. The skip set covers everything we never want to scan:
 * `node_modules`, generated outputs (`build`/`dist`/`out`/`target`),
 * VCS metadata, caches, and `upstream/` vendor trees. The generator
 * shape lets callers stop scanning early without buffering the whole
 * tree.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

export const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'build',
  'dist',
  'out',
  'target',
  '.cache',
  'upstream',
])

export const walk = function* (
  repoRoot: string,
  dir: string,
  filter: (relPath: string) => boolean,
): Generator<string> {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) {
      continue
    }
    const full = path.join(dir, e.name)
    const rel = path.relative(repoRoot, full)
    if (e.isDirectory()) {
      yield* walk(repoRoot, full, filter)
    } else if (e.isFile() && filter(rel)) {
      yield rel
    }
  }
}
