/*
 * @file Repo-ROOT anchoring for hook runtime state. Every dep-0 store a hook
 *   writes lives at `<repo root>/node_modules/.cache/fleet/<name>/` — exactly
 *   one store per checkout, per the runtime-state doctrine.
 *
 *   The dirs hooks are handed are NOT repo roots. A hook payload's `cwd`, the
 *   agent-provided `CLAUDE_PROJECT_DIR`, `process.cwd()`, and the walk-up
 *   fallback in project-dir.mts all point wherever the caller happened to
 *   stand — and under the wheelhouse that is routinely `template/base`, since
 *   the walk-up starts at this file's own location and the hook tree is
 *   mirrored there. Joining `node_modules/` onto such a dir creates a
 *   manifest-less directory under a pnpm workspace glob, and pnpm then fails
 *   EVERY `pnpm run <script>` in the checkout with
 *   ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND — lint, format, test, and the
 *   pre-commit gate all down at once.
 *
 *   Resolving the git toplevel first collapses all of those inputs onto the
 *   one real root. Non-git consumers still work: when git cannot answer, the
 *   input dir is returned unchanged.
 */

import { gitOut } from './git-branch.mts'

// One `git rev-parse` per distinct input dir. Hooks run on every tool call and
// a store path is resolved several times per run, so the probe is memoized for
// the process lifetime; a checkout's toplevel does not move mid-process.
const REPO_ROOT_CACHE = new Map<string, string>()

/**
 * The git toplevel of `dir`, falling back to `dir` when git cannot answer
 * (not a repo, git unavailable, dir missing). Anchor every
 * `node_modules/.cache/fleet/...` store path on this, never on the raw dir.
 */
export function resolveRepoRoot(dir: string): string {
  const cached = REPO_ROOT_CACHE.get(dir)
  if (cached !== undefined) {
    return cached
  }
  const top = gitOut(dir, ['rev-parse', '--show-toplevel'])
  const root = top || dir
  REPO_ROOT_CACHE.set(dir, root)
  return root
}
