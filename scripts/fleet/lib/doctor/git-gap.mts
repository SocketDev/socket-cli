/**
 * @file Gap #5/6/10 engine — git hygiene probes.
 *   Pure functions, no FS reads, no network. The doctor.mts caller runs git and
 *   passes the output strings here. Each probe is a detect+format pair that
 *   returns a DoctorFinding with the four-ingredient What/Where/Saw/Fix shape.
 *   All findings are report-only (fixable: false) — the fixes are operator git
 *   commands, never auto-run by the doctor.
 */

import type { DoctorFinding } from './catalog-gap.mts'

/**
 * %G? signature codes from `git log --format=%H%x09%G?`:
 * G/U/X/Y/R = has a valid or untrusted sig; N/E/B = no valid sig.
 */
const UNSIGNED_CODES = new Set(['B', 'E', 'N'])

/**
 * Detect unpushed default-branch commits that lack a GPG/SSH signature.
 *
 * @param logOutput - Stdout of: `git log --format=%H%x09%G?
 *   origin/<default>..HEAD` Each line: `<sha>\t<G?-code>` (possibly empty when
 *   HEAD == origin/<default>).
 *
 * @returns A DoctorFinding listing unsigned commit SHAs, or undefined when all
 *   commits are signed (or when the log is empty — nothing unpushed).
 */
export function detectUnsignedCommits(
  logOutput: string,
): DoctorFinding | undefined {
  const unsigned: string[] = []
  for (const line of logOutput.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const tab = trimmed.indexOf('\t')
    if (tab < 0) {
      continue
    }
    const sha = trimmed.slice(0, tab).trim()
    const code = trimmed.slice(tab + 1).trim()
    if (sha && UNSIGNED_CODES.has(code)) {
      unsigned.push(sha.slice(0, 12))
    }
  }
  if (unsigned.length === 0) {
    return undefined
  }
  return formatUnsignedCommitsFinding(unsigned)
}

/**
 * Format a finding for unsigned commits on the default branch.
 */
export function formatUnsignedCommitsFinding(
  unsignedShas: string[],
): DoctorFinding {
  const list = unsignedShas.join(', ')
  return {
    fix: [
      `Sign the commits interactively:`,
      ``,
      `  git rebase --exec 'git commit --amend -S --no-edit' origin/<default>`,
      ``,
      `Or sign each commit individually:`,
      ``,
      `  git commit --amend -S --no-edit  # for a single HEAD commit`,
      ``,
      `Commits on main must be signed (fleet commit-signing rule).`,
      `Ensure your signing key is configured: git config --global user.signingkey <key>`,
    ].join('\n'),
    fixable: false,
    saw: `unsigned commit(s) in origin/<default>..HEAD: ${list}`,
    wanted:
      'all unpushed main-branch commits carry a valid GPG or SSH signature',
    what: `Unsigned commits on default branch: ${unsignedShas.length} commit(s) lack a valid signature`,
    where: 'git log origin/<default>..HEAD (unpushed commits)',
  }
}

/**
 * Detect when the local default branch has diverged from origin (behind > 0),
 * meaning it is not fast-forwardable. A pure ahead count is healthy (unpushed
 * local work). Behind > 0 means a merge or rebase is required before push.
 *
 * For a repo on the `squash-history` cadence, local main is canonical and the
 * publish step squashes local history and force-pushes over origin. Divergence
 * (behind > 0) is the intended steady state there, not a defect, so the probe
 * returns nothing — surfacing it would be a false alarm and the reconcile /
 * do-not-force-push advice would be wrong.
 *
 * @param ahead - Commits local has that origin does not.
 * @param behind - Commits origin has that local does not.
 * @param options.squashHistory - True when the repo squashes + force-pushes;
 *   suppresses the finding.
 *
 * @returns A DoctorFinding when behind > 0 and the repo is not on the
 *   squash-history cadence, undefined otherwise.
 */
export function detectDivergedMain(
  ahead: number,
  behind: number,
  options?: { squashHistory?: boolean | undefined } | undefined,
): DoctorFinding | undefined {
  if (behind <= 0 || options?.squashHistory) {
    return undefined
  }
  return formatDivergedMainFinding(ahead, behind)
}

/**
 * Format a finding for a diverged default branch.
 */
export function formatDivergedMainFinding(
  ahead: number,
  behind: number,
): DoctorFinding {
  return {
    fix: [
      `Run the fleet land helper to reconcile:`,
      ``,
      `  node scripts/fleet/managing-worktrees.mts land`,
      ``,
      `Or rebase manually:`,
      ``,
      `  git fetch origin`,
      `  git rebase origin/<default>`,
      ``,
      `The local default branch must always be fast-forwardable to origin`,
      `(ahead-only). A diverged branch blocks push and indicates a concurrent`,
      `session or a mis-landed commit. Do not force-push without explicit approval.`,
    ].join('\n'),
    fixable: false,
    saw: `local branch is ${ahead} ahead and ${behind} behind origin/<default> — diverged, not fast-forwardable`,
    wanted:
      'local default branch is ahead-only (0 commits behind origin/<default>)',
    what: `Diverged default branch: local is ${behind} commit(s) behind origin`,
    where: 'git rev-list --left-right --count origin/<default>...HEAD',
  }
}

/**
 * Parse a single `git worktree list --porcelain` stanza for a worktree path and
 * branch. Returns undefined when the stanza describes the main worktree (HEAD
 * only, no branch line) or a detached HEAD.
 */
export interface WorktreeEntry {
  branch: string
  path: string
}

/**
 * Parse `git worktree list --porcelain` output into a list of secondary
 * worktree entries. The main worktree (the repo root) is skipped — only
 * additional worktrees are returned.
 *
 * Git porcelain format per stanza:
 * worktree <path>
 * HEAD <sha>
 * branch refs/heads/<name>   ← present for a normal branch
 * detached                   ← present instead of branch when detached
 * (blank line separates stanzas)
 */
export function parseWorktrees(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let currentPath: string | undefined
  let isFirst = true
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (isFirst) {
        // The very first `worktree` stanza is always the main worktree (the repo
        // root itself). Skip it.
        isFirst = false
        currentPath = undefined
        continue
      }
      currentPath = line.slice('worktree '.length).trim()
    } else if (line.startsWith('branch refs/heads/') && currentPath) {
      const branch = line.slice('branch refs/heads/'.length).trim()
      entries.push({ branch, path: currentPath })
      currentPath = undefined
    } else if (line === 'detached' && currentPath) {
      // Detached HEAD worktree — no branch name; skip.
      currentPath = undefined
    }
  }
  return entries
}

/**
 * Detect removable worktrees. A worktree is flagged when its branch matches the
 * cascade worktree pattern (`chore/wheelhouse-<sha>`) — those are managed by
 * the cascade and are the primary source of removable worktrees the doctor
 * surfaces. The operator decides whether to remove; the doctor never mutates
 * git state.
 *
 * @param porcelain - Stdout of `git worktree list --porcelain`.
 *
 * @returns A DoctorFinding listing removable worktrees, or undefined when none
 *   match the cascade pattern.
 */
export function detectRemovableWorktrees(
  porcelain: string,
): DoctorFinding | undefined {
  const worktrees = parseWorktrees(porcelain)
  const cascade: WorktreeEntry[] = []
  for (const wt of worktrees) {
    if (/^chore\/wheelhouse-[0-9a-f]+$/.test(wt.branch)) {
      cascade.push(wt)
    }
  }
  if (cascade.length === 0) {
    return undefined
  }
  return formatRemovableWorktreesFinding(cascade)
}

/**
 * Format a finding for removable cascade worktrees.
 */
export function formatRemovableWorktreesFinding(
  removable: WorktreeEntry[],
): DoctorFinding {
  const list = removable.map(wt => `  ${wt.branch}  ${wt.path}`).join('\n')
  return {
    fix: [
      `Remove each superseded cascade worktree:`,
      ``,
      `  node scripts/repo/cleanup-stranded.mts --target . --dry-run`,
      `  node scripts/repo/cleanup-stranded.mts --target .`,
      ``,
      `Omitting --dry-run performs a destructive git reset --hard to origin/<base>.`,
      ``,
      `Or remove individually with git:`,
      ``,
      `  git worktree remove --force <path>`,
      `  git branch -D <branch>`,
      ``,
      `See: docs/agents.md/fleet/stranded-cascades.md`,
    ].join('\n'),
    fixable: false,
    saw: `${removable.length} cascade worktree(s) with superseded chore/wheelhouse-<sha> branch(es):\n${list}`,
    wanted: 'no superseded chore/wheelhouse-<sha> worktrees present',
    what: `Removable cascade worktrees: ${removable.length} superseded worktree(s) detected`,
    where: 'git worktree list --porcelain',
  }
}
