/**
 * @file Pure classifier for a dangerous tracked symlink. Shared by the
 *   `tracked-symlinks-are-safe` check (reads the git object's target) so the
 *   "is this link self-referential / repo-internal-absolute / a tracked
 *   node_modules" rule lives in one place. The motivating bug: a `node_modules`
 *   symlink whose target was the repo's OWN absolute `node_modules` path (`a/b
 *   → /Users/x/repo/a/b`) shipped in the tree and broke `pnpm install`
 *   fleet-wide with `ELOOP`. A symlink that must be tracked should be RELATIVE
 *   and point OUTSIDE its own subtree; an absolute path inside the repo is
 *   machine-specific and loop-prone.
 */

import path from 'node:path'

export interface BadSymlink {
  readonly linkPath: string
  readonly target: string
  readonly reason: string
}

/**
 * Classify a tracked symlink. `linkPath` is repo-relative (POSIX `/`), `target`
 * is the raw link text, `repoRoot` is the absolute repo root. Returns a
 * `BadSymlink` describing the problem, or `undefined` when the link is safe
 * (relative + pointing outside its own subtree).
 */
export function classifyTrackedSymlink(
  linkPath: string,
  target: string,
  repoRoot: string,
): BadSymlink | undefined {
  const norm = (p: string): string => p.replace(/\\/g, '/')
  const link = norm(linkPath)
  const tgt = norm(target)

  // A tracked node_modules is always wrong (it is gitignored; tracking it at
  // all — symlink or real — is the defect), and was the exact incident.
  if (link === 'node_modules' || link.endsWith('/node_modules')) {
    return {
      linkPath: link,
      target: tgt,
      reason: 'node_modules must never be tracked (it is gitignored)',
    }
  }

  if (!tgt) {
    return undefined
  }

  // Resolve the link target the way the OS would: relative to the link's dir.
  const linkAbs = path.posix.resolve('/', link)
  const targetAbs = path.posix.isAbsolute(tgt)
    ? norm(tgt)
    : path.posix.resolve(path.posix.dirname(linkAbs), tgt)

  // Self-referential: the target resolves to the link's own path.
  if (targetAbs === linkAbs || norm(tgt) === norm(repoRoot) + '/' + link) {
    return {
      linkPath: link,
      target: tgt,
      reason: 'self-referential (target resolves to its own path)',
    }
  }

  // Absolute path INSIDE this repo: machine-specific + loop-prone. A real
  // intra-repo symlink should be relative.
  const repoAbs = norm(repoRoot)
  if (
    path.posix.isAbsolute(tgt) &&
    (tgt === repoAbs || tgt.startsWith(repoAbs + '/'))
  ) {
    return {
      linkPath: link,
      target: tgt,
      reason: 'absolute path inside the repo (use a relative link)',
    }
  }

  return undefined
}
