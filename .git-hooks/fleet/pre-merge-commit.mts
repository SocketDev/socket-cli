#!/usr/bin/env node
// Socket Security Pre-merge-commit Hook
//
// Git runs this with NO arguments immediately before it creates a merge
// commit, and a non-zero exit aborts the merge. That is the only stage where
// a merge commit can still be stopped: `commit-msg` and `pre-commit` never
// run for `git merge`, so without this hook an AI attribution trailer or a
// denied author reaches history through the merge path unchecked.
//
// Two assertions, the same two the commit path runs:
//   1. The pending merge message (.git/MERGE_MSG) carries no AI attribution.
//   2. The author and committer identities pass the cascaded git-authors
//      policy.
//
// Attribution is BLOCKED here rather than stripped. `commit-msg` owns the
// rewrite because git hands it the message file and re-reads it afterwards;
// git does not re-read MERGE_MSG after this hook, so a silent rewrite would
// be dropped and read as a pass.
//
// Wired via .git-hooks/fleet/pre-merge-commit, the sibling shell shim, which
// the root .git-hooks/pre-merge-commit dispatcher invokes when
// `core.hooksPath` points at .git-hooks/ — set by
// `node scripts/install-git-hooks.mts` at `pnpm install` time.

import { existsSync, readFileSync } from 'node:fs'

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { gitLines } from '../_shared/helpers.mts'
// Canonical shared identity reader (.git-hooks/_shared/). Same source the
// commit-author-guard PreToolUse hook and the commit-msg git-stage backstop
// use; the DATA is the cascaded .config/fleet|repo/git-authors.json.
import {
  isAllowedAuthor,
  isDeniedIdentity,
  parseGitIdentLine,
  readIdentityPolicy,
} from '../_shared/git-identity.mts'
import type { IdentityPolicy } from '../_shared/git-identity.mts'
// The fleet's single definition of "AI attribution" — the same catalog the
// commit-msg hook strips with and the history gate scans with. Imported
// directly (not through the helpers barrel) because only this module carries
// the line-oriented matchers this hook needs.
import {
  hasAiAttribution,
  matchAiCommitAttribution,
} from '../../.claude/hooks/fleet/_shared/ai-attribution.mts'

const logger = getDefaultLogger()

/**
 * One reason the merge is blocked: the headline the operator sees, and the
 * remediation line under it.
 */
export interface MergeBlocker {
  readonly what: string
  readonly fix: string
}

/**
 * The pending merge message git will use for the commit it is about to
 * create, or an empty string when the file is absent (a merge that resolved
 * with nothing to record, or a hook run outside a merge).
 */
export function readPendingMergeMessage(gitDir: string): string {
  const file = path.join(gitDir, 'MERGE_MSG')
  if (!existsSync(file)) {
    return ''
  }
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * The AI-attribution blocker a merge message earns, or undefined when the
 * message is clean. The named line comes from the scanner-fingerprint matcher
 * when one fires, so the operator is told which line to delete.
 */
export function findMergeMessageAttribution(
  message: string,
): MergeBlocker | undefined {
  if (!hasAiAttribution(message)) {
    return undefined
  }
  const match = matchAiCommitAttribution(message)
  const where = match ? `${match.label}: ${match.line}` : 'the merge message'
  return {
    what: `Merge blocked: the merge message carries AI attribution (${where}).`,
    fix: 'Delete the attribution line, then re-run the merge. Edit it with `git merge --continue` and remove the line from the message git opens, or `git merge --abort` and redo the merge with a clean message.',
  }
}

/**
 * The identity blockers the author and committer earn under `policy`. Reads
 * both identities from `git var` so the check matches the values git is about
 * to stamp on the merge commit, not whatever the config files say.
 */
export function findMergeIdentityBlockers(
  policy: IdentityPolicy,
): MergeBlocker[] {
  const blockers: MergeBlocker[] = []
  for (const which of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT'] as const) {
    let ident = ''
    try {
      ident = gitLines('var', which)[0] ?? ''
    } catch {
      // `git var` failed, unusual env — fail open, don't block a real merge.
      continue
    }
    const who = parseGitIdentLine(ident)
    const denied = isDeniedIdentity(who, policy)
    if (!denied && isAllowedAuthor(who, policy)) {
      continue
    }
    const label = which === 'GIT_AUTHOR_IDENT' ? 'author' : 'committer'
    const id = `${who.name ?? '(unset)'} <${who.email ?? '(unset)'}>`
    blockers.push({
      what: denied
        ? `Merge blocked: ${label} is a placeholder/sandbox identity ${id}.`
        : `Merge blocked: ${label} ${id} is not on the allowed-author list.`,
      fix: 'Set a real identity (`git config user.email "<you>@<domain>"`), then re-run the merge. Allowed authors come from .config/repo/git-authors.json (per-repo) over .config/fleet/git-authors.json (cascaded); placeholder identities (test@example.com, Test, …) are never allowed.',
    })
  }
  return blockers
}

/**
 * Every reason the pending merge commit is blocked, attribution first so the
 * operator reads the message problem before the identity problem.
 */
export function findMergeCommitBlockers(
  message: string,
  policy: IdentityPolicy,
): MergeBlocker[] {
  const attribution = findMergeMessageAttribution(message)
  return [
    ...(attribution ? [attribution] : []),
    ...findMergeIdentityBlockers(policy),
  ]
}

function main(): number {
  let gitDir = '.git'
  try {
    gitDir = gitLines('rev-parse', '--git-dir')[0] || '.git'
  } catch {
    // Not a git repo, or `git rev-parse` failed — nothing to gate.
    return 0
  }
  const cwd = process.cwd()
  const message = readPendingMergeMessage(gitDir)
  const policy = readIdentityPolicy(cwd)
  const blockers = findMergeCommitBlockers(message, policy)
  for (let i = 0, { length } = blockers; i < length; i += 1) {
    const blocker = blockers[i]!
    logger.fail(blocker.what)
    logger.info(blocker.fix)
  }
  return blockers.length > 0 ? 1 : 0
}

// Entrypoint-guarded: the unit tests import this module for its exported
// matchers, and importing it must not run the hook against the caller's repo.
const entry = process.argv[1]
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
