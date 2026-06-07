/**
 * @file Canonical path constants for the researching-recency engine. Mantra:
 *   1 path, 1 reference. Inherits REPO_ROOT and the shared resolvers from the
 *   fleet `scripts/fleet/paths.mts`; adds the engine's own save-dir constant
 *   below the re-export line. Consumers import the constructed value rather
 *   than re-deriving the path.
 *
 * @see CLAUDE.md "1 path, 1 reference".
 */

import path from 'node:path'

export * from '../paths.mts'

import { REPO_ROOT } from '../paths.mts'

// Default directory for saved raw research briefs. Lives under the repo's
// reports tier (never tracked — the fleet .gitignore excludes /.claude/*),
// so a brief written during a session can't leak into a commit. Overridable
// per-invocation via --save-dir.
export const RESEARCH_SAVE_DIR = path.join(
  REPO_ROOT,
  '.claude',
  'reports',
  'researching-recency',
)
