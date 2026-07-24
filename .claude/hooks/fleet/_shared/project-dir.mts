/*
 * @file Project-root resolution for hooks. `process.cwd()` is forbidden in
 *   `.claude/hooks/` (socket/no-process-cwd-in-scripts-hooks) — the agent
 *   runner may invoke a hook from any directory. Resolution order: the
 *   caller's preferred dir (usually the hook payload's `cwd`), then the
 *   agent-provided `CLAUDE_PROJECT_DIR`, then a last-resort walk up from this
 *   file's own location (`.claude/hooks/fleet/_shared/`) to the repo root.
 *   The bundled copy lives at `.claude/hooks/fleet/_dispatch/` — the same
 *   depth, so the fixed walk holds for both source and bundle.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FALLBACK_PROJECT_DIR = path.join(HERE, '..', '..', '..', '..')

/**
 * The project root a hook should operate on. `preferred` (the hook payload's
 * `cwd`, when the caller has one) wins, then `CLAUDE_PROJECT_DIR`, then the
 * repo root this hook tree is installed in. Empty strings fall through.
 */
export function resolveProjectDir(preferred?: string | undefined): string {
  return preferred || process.env['CLAUDE_PROJECT_DIR'] || FALLBACK_PROJECT_DIR
}
