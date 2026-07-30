/**
 * @file Cargo workspace discovery shared by the Rust runners
 *   (`fmt-rust.mts`, `lint-rust.mts`). Walks a repo for first-party
 *   `Cargo.toml` manifests, skipping vendored/generated code and other
 *   sessions' agent worktrees, and keeps only the OUTERMOST manifest of each
 *   workspace — a `--workspace`/`--all` run at the outer root already covers
 *   every member, so running a member manifest too would double the work and
 *   double-report every finding.
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// Directories whose Rust is not ours to lint or format: vendored/upstream
// drops, package-manager output, build output, and per-checkout caches.
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'coverage',
  'deps',
  'external',
  'node_modules',
  'target',
  'third_party',
  'upstream',
  'vendor',
])

// Agent worktrees are full checkouts of this repo living inside it, so the
// walk would find their manifests and act on source another session is
// editing. Matched on the path rather than the directory name so a repo that
// legitimately owns a `worktrees/` directory keeps its Rust covered.
const WORKTREE_ROOT = '.claude/worktrees'

export function isAgentWorktreePath(dirPath: string): boolean {
  const p = normalizePath(dirPath)
  return p === WORKTREE_ROOT || p.endsWith(`/${WORKTREE_ROOT}`)
}

export function findWorkspaceManifests(root: string): string[] {
  const manifests: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const name = entries[i]!
      if (
        SKIP_DIRS.has(name) ||
        name.endsWith('-bundled') ||
        name.endsWith('-vendored')
      ) {
        continue
      }
      const abs = path.join(dir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (!isAgentWorktreePath(abs)) {
          stack.push(abs)
        }
      } else if (name === 'Cargo.toml') {
        manifests.push(abs)
      }
    }
  }
  // Outermost manifests only: drop any manifest nested under another
  // manifest's directory. Such a manifest is a workspace member, and the outer
  // run already covers it.
  const sorted = manifests
    .map(m => normalizePath(m))
    .toSorted((a, b) => a.length - b.length)
  const roots: string[] = []
  for (let i = 0, { length } = sorted; i < length; i += 1) {
    const m = sorted[i]!
    if (!roots.some(r => m.startsWith(`${path.posix.dirname(r)}/`))) {
      roots.push(m)
    }
  }
  return roots
}
