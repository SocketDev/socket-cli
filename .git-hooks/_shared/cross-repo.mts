// Cross-repo path matchers — shared by the commit-time scanCrossRepoPaths
// (.git-hooks/_shared/helpers.mts) and the edit-time cross-repo-guard
// (.claude/hooks/fleet/). Both built the identical regexes from
// FLEET_REPO_NAMES inline; this is the single source so they can't drift.
// Gate-free (no Node-25 hard-exit) so the Claude hook imports it on the
// operator's possibly-older Node. Each consumer keeps its own scanner FUNCTION
// (they differ in deps + doc-skip context); only the regexes are shared.
//
// A cross-repo reference is a `../<repo>/…` relative escape or a
// `…/projects/<repo>/…` absolute path into a sibling fleet repo. The fix is
// always an `@socketsecurity/<pkg>` package import, never a path.

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { FLEET_REPO_NAMES } from '../../.claude/hooks/fleet/_shared/fleet-repos.mts'

const FLEET_RE_FRAGMENT = FLEET_REPO_NAMES.join('|')

// `../<repo>/…` (any depth of `../`) preceded by a path boundary so we don't
// re-match a repo name already inside a longer token.
export const CROSS_REPO_RELATIVE_RE = new RegExp(
  String.raw`(?:^|[\s'"\`(=,])\.\.(?:/\.\.)*/(?:${FLEET_RE_FRAGMENT})/`,
)

// `…/projects/<repo>/…` — absolute or env-rooted variant. Catches cases where
// a personal-path scan was satisfied via `${HOME}` / `<user>` substitution but
// the path still escapes into another repo.
export const CROSS_REPO_ABSOLUTE_RE = new RegExp(
  String.raw`/projects/(?:${FLEET_RE_FRAGMENT})/`,
)

export const CROSS_REPO_ANY_RE = new RegExp(
  `${CROSS_REPO_RELATIVE_RE.source}|${CROSS_REPO_ABSOLUTE_RE.source}`,
)

// Repo root for a file: nearest ancestor of its directory containing a `.git`
// entry — a directory in a normal clone, a file in a git worktree (existsSync
// matches both). Layout-independent: makes NO assumption about where the repo
// lives on disk (CI runners, fresh clones, and dev checkouts all differ),
// unlike a hardcoded `projects/<repo>` guess. Undefined when outside any repo.
function findRepoRoot(fileAbsPath: string): string | undefined {
  let dir = path.dirname(path.resolve(fileAbsPath))
  for (let prev = ''; dir !== prev; prev = dir, dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) {
      return dir
    }
  }
  return undefined
}

// The bare name of the repo a file belongs to — its `.git` root's basename, or
// undefined when the file is outside any repo. DERIVED from the path so callers
// never have to pass (and keep in sync) a separate repo-name argument, and with
// no `projects/<repo>` layout assumption.
export function repoNameForFile(fileAbsPath: string): string | undefined {
  const repoRoot = findRepoRoot(fileAbsPath)
  return repoRoot ? path.basename(resolveTrueRepoRoot(repoRoot)) : undefined
}

// In a LINKED WORKTREE the walk-up root's `.git` is a FILE whose `gitdir:`
// pointer ends in `<primary>/.git/worktrees/<name>` — the worktree
// directory's own basename (e.g. a `.wt-*` scratch checkout) is NOT the
// repo's name. Resolve the primary root so own-repo references keep reading
// as own-repo inside worktrees; without this, absolute paths naming the
// repo's canonical name false-flagged as cross-repo escapes on every
// worktree run (coverage runs 10-11, 2026-07-12). Falls back to the given
// root on any read/parse miss — never worse than the old behavior.
export function resolveTrueRepoRoot(repoRoot: string): string {
  const gitEntry = path.join(repoRoot, '.git')
  try {
    if (!statSync(gitEntry).isFile()) {
      return repoRoot
    }
    const pointer = readFileSync(gitEntry, 'utf8').trim()
    const m = /^gitdir:\s*(.+?)[/\\]\.git[/\\]worktrees[/\\][^/\\]+$/.exec(
      pointer,
    )
    return m?.[1] ? m[1] : repoRoot
  } catch {
    return repoRoot
  }
}

// A matched RELATIVE token (a `..`-traversal ending in a repo name) is a genuine
// cross-repo escape only when it resolves to a path OUTSIDE the file's own repo.
// A token that normalizes back INSIDE the repo — e.g. one resolving to
// `.claude/skills/`, whose `skills` segment collides with the `skills` fleet-repo
// name — is intra-repo and must not be flagged.
//
// The repo root is found by walking up to `.git` from the file (layout-agnostic
// — no `projects/<repo>` assumption). Resolution is normalized to `/`. Returns
// true (escape) when no enclosing repo is found, keeping the guard fail-closed.
export function relativeTokenEscapesRepo(
  matchedToken: string,
  fileAbsPath: string,
): boolean {
  const repoRoot = findRepoRoot(fileAbsPath)
  if (!repoRoot) {
    return true
  }
  const fileDir = path.dirname(path.resolve(fileAbsPath))
  // Strip the regex's leading boundary char + trailing slash, leaving the
  // traversal core to resolve against the file's directory.
  const core = matchedToken.replace(/^[^.]*/, '').replace(/\/+$/, '')
  const resolved = normalizePath(path.resolve(fileDir, core))
  const root = normalizePath(repoRoot)
  return resolved !== root && !resolved.startsWith(`${root}/`)
}
