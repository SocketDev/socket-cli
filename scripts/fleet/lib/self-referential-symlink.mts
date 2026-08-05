/**
 * @file Pure classifier for a dangerous symlink, shared by the two layers that
 *   enforce the rule: the `no-self-referential-symlink-guard` hook (edit time —
 *   what a `git add` WOULD stage) and the `tracked-symlinks-are-safe` check
 *   (commit time — what the index already holds). Keeping the rule here is what
 *   stops the two from drifting into disagreement. The motivating bug: a
 *   `node_modules` symlink whose target was an absolute machine path (`a/b →
 *   /Users/x/repo/a/b`) shipped in the tree and broke `pnpm install` fleet-wide
 *   with `ELOOP`; the second incident committed the same shape through a broad
 *   `git add -A` because `.gitignore` said `node_modules/` — a trailing slash
 *   matches a DIRECTORY, and a symlink is a file to git. A symlink that must be
 *   tracked should be RELATIVE and point OUTSIDE its own subtree; an absolute
 *   path inside the repo is machine-specific and loop-prone.
 */

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

export interface BadSymlink {
  readonly linkPath: string
  readonly target: string
  readonly reason: string
}

/**
 * The one reason string for the node_modules rule, so the guard's block message
 * and the check's failure line say the same thing.
 */
export const NODE_MODULES_REASON =
  'node_modules must never be tracked (it is gitignored)'

/**
 * True when `p` is a `node_modules` directory or anything beneath one. Wider
 * than "the link itself is named node_modules": a `git add` can stage
 * `node_modules/pkg/index.js` directly, and every path under the directory is
 * the same defect. Accepts repo-relative or absolute, POSIX or Windows
 * separators.
 */
export function isNodeModulesPath(p: string): boolean {
  const n = normalizePath(p)
  return (
    n === 'node_modules' ||
    n.startsWith('node_modules/') ||
    n.endsWith('/node_modules') ||
    n.includes('/node_modules/')
  )
}

/**
 * Resolve a link's target into the repo's own path space — `/` is the repo
 * root — or `undefined` when the target lands OUTSIDE the repo (an absolute
 * path elsewhere on the machine, or a relative target with enough `..` to climb
 * past the root). `linkAbs` is the link's own repo-space path.
 *
 * Why not `path.posix.resolve`: it CLAMPS at `/`, so `a/link → ../../../x`
 * silently reads as the in-repo `/x` and a link that genuinely escapes the repo
 * gets judged against paths it cannot reach. Walking the segments by hand lets
 * an escape report itself as an escape.
 */
export function resolveTargetInRepo(
  linkAbs: string,
  target: string,
  repoRoot: string,
): string | undefined {
  const tgt = normalizePath(target)
  if (path.posix.isAbsolute(tgt)) {
    const repoAbs = normalizePath(repoRoot)
    if (tgt === repoAbs) {
      return '/'
    }
    return tgt.startsWith(repoAbs + '/') ? tgt.slice(repoAbs.length) : undefined
  }
  const dir = path.posix.dirname(linkAbs)
  const segments = (dir === '/' ? [] : dir.slice(1).split('/')).concat(
    tgt.split('/'),
  )
  const stack: string[] = []
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const segment = segments[i]!
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment !== '..') {
      stack.push(segment)
      continue
    }
    if (stack.length === 0) {
      return undefined
    }
    stack.pop()
  }
  return '/' + stack.join('/')
}

/**
 * Classify a symlink. `linkPath` is repo-relative (POSIX `/`), `target` is the
 * raw link text, `repoRoot` is the absolute repo root. Returns a `BadSymlink`
 * describing the problem, or `undefined` when the link is safe (relative +
 * pointing outside its own subtree).
 */
export function classifyTrackedSymlink(
  linkPath: string,
  target: string,
  repoRoot: string,
): BadSymlink | undefined {
  const link = normalizePath(linkPath)
  const tgt = normalizePath(target)

  // A tracked node_modules is always wrong (it is gitignored; tracking it at
  // all — symlink or real — is the defect), and was the exact incident.
  if (isNodeModulesPath(link)) {
    return { linkPath: link, target: tgt, reason: NODE_MODULES_REASON }
  }

  // An empty link body is a degenerate/broken link, not a loop — git can hold
  // one, and there is nothing for it to point at. Test the RAW text: an empty
  // string normalizes to `.`, which is a real (and looping) target.
  if (!target.trim()) {
    return undefined
  }

  const linkAbs = path.posix.resolve('/', link)
  const targetInRepo = resolveTargetInRepo(linkAbs, tgt, repoRoot)

  // Self-referential: the target resolves to the link's own path.
  if (targetInRepo === linkAbs) {
    return {
      linkPath: link,
      target: tgt,
      reason: 'self-referential (target resolves to its own path)',
    }
  }

  // The target is an ANCESTOR of the link, so walking through the link re-enters
  // the directory chain that contains it: `a/b/link → ..` expands to
  // `a/b/link/link/link/…` forever. Same ELOOP, one level up from the exact
  // self-reference above.
  if (
    targetInRepo !== undefined &&
    linkAbs.startsWith(targetInRepo === '/' ? '/' : targetInRepo + '/')
  ) {
    return {
      linkPath: link,
      target: tgt,
      reason:
        'self-referential (target is an ancestor of the link, so the path loops)',
    }
  }

  // Absolute path INSIDE this repo: machine-specific + loop-prone. A real
  // intra-repo symlink should be relative.
  const repoAbs = normalizePath(repoRoot)
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

/**
 * Classify a path a `git add` would stage. `target` is the link body when the
 * worktree entry is a symlink, `undefined` when it is a regular file or
 * directory — a plain file still fails the node_modules rule, which is the only
 * rule that does not need a link body. The caller does the filesystem read so
 * this module stays pure and unit-testable without a fixture tree.
 */
export function classifyStagedPath(
  stagedPath: string,
  target: string | undefined,
  repoRoot: string,
): BadSymlink | undefined {
  if (isNodeModulesPath(stagedPath)) {
    return {
      linkPath: normalizePath(stagedPath),
      target: target === undefined ? '' : normalizePath(target),
      reason: NODE_MODULES_REASON,
    }
  }
  if (target === undefined) {
    return undefined
  }
  return classifyTrackedSymlink(stagedPath, target, repoRoot)
}
