// Pre-push commit-range computation. Resolves the `<base>..<local>` range the
// security gates scan for a given push line, handling new branches, force-pushes,
// and default-branch fallback. Returns undefined for skip cases (tags,
// deletions, no baseline).

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { git } from './git.mts'

const logger = getDefaultLogger()

export const ZERO_SHA = '0000000000000000000000000000000000000000'

// Computes the commit range to scan. Returns null if no scan needed
// (skip case — tag, delete, or no baseline).
export const computeRange = (
  remote: string,
  localRef: string,
  localSha: string,
  remoteSha: string,
): string | undefined => {
  if (localRef.startsWith('refs/tags/')) {
    logger.info(`Skipping tag push: ${localRef}`)
    return undefined
  }
  if (localSha === ZERO_SHA) {
    return undefined
  }

  const refExists = (ref: string): boolean => {
    const r = spawnSync('git', ['rev-parse', ref])
    return r.status === 0
  }

  const defaultBranchOf = (remoteName: string): string => {
    const sym = git('symbolic-ref', `refs/remotes/${remoteName}/HEAD`).trim()
    if (sym) {
      return sym.replace(`refs/remotes/${remoteName}/`, '')
    }
    // symbolic-ref unset (rare — happens with shallow clones, partial
    // fetches, freshly-init'd remotes). Try main → master → 'main'
    // per CLAUDE.md default-branch resolution. Reversing the order
    // would mispick during rename migrations.
    if (refExists(`${remoteName}/main`)) {
      return 'main'
    }
    if (refExists(`${remoteName}/master`)) {
      return 'master'
    }
    return 'main'
  }

  // git cat-file -e exits 0 silently on success; spawnSync directly
  // so we can inspect status without printing.
  const remoteShaExists = (sha: string): boolean => {
    const result = spawnSync('git', ['cat-file', '-e', sha])
    return result.status === 0
  }

  if (remoteSha === ZERO_SHA) {
    // New branch — compare against remote default branch.
    const def = defaultBranchOf(remote)
    const baseRef = `${remote}/${def}`
    if (!refExists(baseRef)) {
      logger.success('Skipping validation (no baseline to compare against)')
      return undefined
    }
    return `${baseRef}..${localSha}`
  }

  const isAncestor = (ancestor: string, descendant: string): boolean =>
    spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant])
      .status === 0

  // Existing branch.
  if (!remoteShaExists(remoteSha) || !isAncestor(remoteSha, localSha)) {
    // Force-push, history rewrite, or dangling object that is not an
    // ancestor of the local tip — fall back to remote default branch.
    const def = defaultBranchOf(remote)
    const baseRef = `${remote}/${def}`
    if (!refExists(baseRef)) {
      logger.success('Skipping validation (no baseline for force-push)')
      return undefined
    }
    return `${baseRef}..${localSha}`
  }
  return `${remoteSha}..${localSha}`
}
