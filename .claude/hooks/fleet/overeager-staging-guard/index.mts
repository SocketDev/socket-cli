#!/usr/bin/env node
// Claude Code PreToolUse hook — overeager-staging-guard.
//
// Catches the failure mode where an agent's `git commit` sweeps in
// files it didn't author — usually another Claude session's work
// that was already staged when this session opened the repo. Two
// enforcement layers:
//
//   1. BLOCK `git add -A` / `git add .` / `git add --all` / `git add -u`
//      / `git add --update`. These sweep everything in the working
//      tree into the index, which is hostile to parallel-session
//      repos: another agent's unstaged edits get staged into your
//      next commit. Per CLAUDE.md: "surgical `git add <specific-file>`.
//      Never `-A` / `.`."
//
//   2. BLOCK a bare `git commit` (no pathspec) when the index holds files
//      the agent has NOT touched this session (via Edit / Write / `git add
//      <path>` / `git rm <path>`). A bare commit commits the ENTIRE index,
//      so a parallel session's staged work rides in under your authorship.
//      The parallel-safe form is `git commit -o <your-files>` (or
//      `-- <paths>`), which commits ONLY the named paths regardless of the
//      index — those are allowed through. The block message lists the
//      unfamiliar files and suggests the exact `git commit -o` for your
//      session-touched staged files.
//
//      Default posture: commit the SMALLEST explicit set; never let the
//      index sweep up another agent's work.
//
//      Detection heuristic: list staged files, compare against tool-
//      use history in the transcript. Files staged but never touched
//      this session are the unfamiliar set.
//
// Layer 1 blocks (exit 2); Layer 2 blocks a bare sweep (exit 2). Both
// fail open on hook bugs (exit 0 + stderr log).
//
// Bypass:
//   - `Allow add-all bypass` in a recent user turn — disables layer 1.
//   - `Allow index-sweep bypass` — lets a bare commit take the whole index.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     "transcript_path": "/.../session.jsonl" }

import { existsSync } from 'node:fs'
import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isGitCommit } from '../_shared/commit-command.mts'
import { isSquashOptIn } from '../_shared/fleet-roster.mts'
import { readSessionTouchedPaths } from '../_shared/foreign-paths.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  commandsFor,
  detectBroadGitAdd,
  isFleetSyncCommand,
} from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { squashSentinelAllows } from '../_shared/squash-sentinel.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Pre-flight trigger for the dispatcher: every block path runs through a
// `git`-binary detector (`detectBroadGitAdd` → `commandsFor(_, 'git')`, and
// `isGitCommit` → the shared `_shared/commit-command.mts` segment parse),
// each of which short-circuits unless the raw command contains the substring
// `git`. So a command with no `git` can never block — skip importing this
// guard for it.
export const triggers: readonly string[] = ['git']

const BYPASS_PHRASES = ['Allow add-all bypass'] as const
// Separate phrase for the index-sweep block: it's a different decision from the
// `git add -A` block, so it gets its own bypass.
const COMMIT_SWEEP_BYPASS = ['Allow index-sweep bypass'] as const

export function getRepoDir(command: string, cwd?: string | undefined): string {
  // The repo the `git` command actually runs in — `git -C <dir>`, a leading
  // `cd <dir>`, else the command's own cwd. NOT CLAUDE_PROJECT_DIR: that's the
  // session's project (the wheelhouse), so reading its index from a sibling
  // repo's commit cross-repo-false-blocked on the wheelhouse's staged files.
  // Scoped to the commit invocation — a -C inside a $(…) substitution
  // (e.g. a rev-parse composing the message) must not point the index
  // probe at a different repo.
  return extractGitCwd(command, { cwd, subcommand: ['add', 'commit'] })
}

export { isGitCommit }

// True when a `git commit` carries an explicit pathspec — the parallel-safe
// form, because `git commit <paths>` / `-o`/`--only <paths>` commits ONLY those
// paths regardless of what else is in the index. Detect: any positional arg
// after `commit` (a path), or `-o`/`--only`, or a `--` separator, or a
// `--pathspec-from-file=<file>` (pathspec-limits exactly like `-- <paths>`,
// just sourced from a file). Flags that take a value (`-m msg`, `-F file`,
// `--author=…`, etc.) must not be mistaken for a pathspec, so positionals are
// only counted after a `--`, or via the explicit flags (the unambiguous
// signals).
export function commitHasPathspec(command: string): boolean {
  for (const c of commandsFor(command, 'git')) {
    const { args } = c
    const ci = args.findIndex(a => a === 'commit')
    if (ci === -1) {
      continue
    }
    const rest = args.slice(ci + 1)
    if (rest.includes('--')) {
      return true
    }
    if (rest.some(a => a === '--only' || a === '-o')) {
      return true
    }
    if (
      rest.some(
        a =>
          a === '--pathspec-from-file' || a.startsWith('--pathspec-from-file='),
      )
    ) {
      return true
    }
  }
  return false
}

// True when the repo has a merge / cherry-pick / revert in progress. In those
// states git REJECTS partial commits ("fatal: cannot do a partial commit
// during a merge"), so the whole-index commit is the ONLY legal form and the
// sweep block must let it through. The marker refs are resolved via
// `rev-parse --git-path` so linked worktrees (whose `.git` is a file pointing
// at a per-worktree gitdir) resolve correctly.
export function isMidMergeCommit(repoDir: string): boolean {
  const r = spawnSync(
    'git',
    [
      'rev-parse',
      '--git-path',
      'MERGE_HEAD',
      '--git-path',
      'CHERRY_PICK_HEAD',
      '--git-path',
      'REVERT_HEAD',
    ],
    { cwd: repoDir, timeout: spawnTimeoutMs(5000) },
  )
  if (r.status !== 0) {
    return false
  }
  return String(r.stdout)
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean)
    .some(p => existsSync(path.isAbsolute(p) ? p : path.join(repoDir, p)))
}

export function listStagedFiles(repoDir: string): string[] {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: repoDir,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    return []
  }
  return String(r.stdout)
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean)
}

/**
 * New-side paths of STAGED RENAMES (index status `R`). A staged rename is a
 * deliberate `git mv` in THIS checkout — a parallel agent's loose edit never
 * shows up pre-staged as a rename in our index (same reasoning as
 * foreign-paths' listForeignDirtyPaths R-skip). The active-edits ledger only
 * records Edit/Write tool paths, so a rename sweep's 40+ `git mv` targets all
 * read as unfamiliar without this exemption.
 */
export function listStagedRenamedPaths(repoDir: string): Set<string> {
  const r = spawnSync(
    'git',
    ['diff', '--cached', '--name-status', '-M', '--diff-filter=R'],
    { cwd: repoDir, timeout: spawnTimeoutMs(5000) },
  )
  const renamed = new Set<string>()
  if (r.status !== 0) {
    return renamed
  }
  for (const line of String(r.stdout).split('\n')) {
    // `R<score>\t<old>\t<new>` — both sides are session-deliberate.
    const parts = line.split('\t')
    if (parts.length === 3 && parts[0]!.startsWith('R')) {
      renamed.add(parts[1]!.trim())
      renamed.add(parts[2]!.trim())
    }
  }
  return renamed
}

export function checkCommand(command: string, payload: ToolCallPayload) {
  const repoDir = getRepoDir(command, payload.cwd)
  const transcriptPath = payload.transcript_path

  // Squash-history relaxation. A repo opted into `squash-history` flattens its
  // default branch to one commit before every push, so commit order and
  // granularity carry no meaning — a broad `git add -A` or a bare `git commit`
  // that sweeps the index is exactly the "merge merge merge, squash before push"
  // flow, not a hazard. Every op this guard blocks is non-destructive (staging /
  // committing, never losing work), so relaxing the whole guard here is safe.
  if (isSquashOptIn(repoDir)) {
    return undefined
  }

  // ── Layer 1: block `git add -A` / `.` / `-u` ─────────────────────
  const broad = detectBroadGitAdd(command)
  if (broad) {
    // Fleet-sync sentinel: cascade scripts run `git add -u` inside a
    // worktree they just created off origin/main — no parallel-session
    // hazard because the worktree is empty otherwise. Same opt-in
    // sentinel the no-revert-guard recognizes (`FLEET_SYNC=1` prefix).
    if (isFleetSyncCommand(command)) {
      return undefined
    }
    if (
      transcriptPath &&
      bypassPhrasePresent(transcriptPath, BYPASS_PHRASES, 3)
    ) {
      return undefined
    }
    return block(
      [
        `[overeager-staging-guard] Blocked: ${broad}`,
        '',
        '  This sweeps the entire working tree into the index.',
        "  In a parallel-session repo, that pulls in another agent's",
        '  unstaged edits and they get swept into your next commit.',
        '',
        '  Fix: stage by explicit path.',
        '    git add path/to/file.ts path/to/other.ts',
        '',
        '  Bypass (only if you genuinely need a sweep):',
        '    user types "Allow add-all bypass" in chat, then retry.',
      ].join('\n'),
    )
  }

  // ── Layer 2: BLOCK a plain `git commit` that would sweep the whole index
  //    when it holds files this session didn't touch ────────────────────────
  //
  // Parallel-session-cautious by default: a bare `git commit` (no pathspec)
  // commits the ENTIRE index, so another agent's staged work rides in under
  // your authorship. The safe form is `git commit -o <your-files>` (or
  // `-- <paths>`), which commits ONLY the named paths regardless of the index.
  // So: a commit that already names a pathspec is allowed; a bare commit with
  // unfamiliar staged files is blocked, steering to the pathspec form.
  if (isGitCommit(command)) {
    // Wheelhouse cascade legitimately commits the whole index (broad-stage in
    // a fresh worktree off origin/main). The `FLEET_SYNC=1` sentinel — which
    // no-revert-guard already recognizes for cascade `--no-verify` commits —
    // opts out of the sweep block too.
    if (isFleetSyncCommand(command)) {
      return undefined
    }
    // The squashing-history collapse commit stages the whole tree on purpose;
    // the hardened SQUASH_HISTORY=1 sentinel authorizes it (no phrase needed).
    if (squashSentinelAllows(command)) {
      return undefined
    }
    // Pathspec-bearing commit is the safe form — never blocked.
    if (commitHasPathspec(command)) {
      return undefined
    }
    // A merge / cherry-pick / revert commit MUST take the whole index — git
    // rejects the partial form outright, so blocking here would strand every
    // legitimate merge resolution behind a bypass phrase.
    if (isMidMergeCommit(repoDir)) {
      return undefined
    }
    const staged = listStagedFiles(repoDir)
    if (staged.length === 0) {
      return undefined
    }
    const touched = readSessionTouchedPaths(transcriptPath)
    const renamed = listStagedRenamedPaths(repoDir)
    const unfamiliar: string[] = []
    for (let i = 0, { length } = staged; i < length; i += 1) {
      const f = staged[i]!
      if (renamed.has(f)) {
        continue
      }
      const abs = path.resolve(repoDir, f)
      if (!touched.has(abs)) {
        unfamiliar.push(f)
      }
    }
    if (unfamiliar.length === 0) {
      return undefined
    }
    if (
      transcriptPath &&
      bypassPhrasePresent(transcriptPath, COMMIT_SWEEP_BYPASS, 3)
    ) {
      return undefined
    }
    const touchedStaged = staged.filter(f => !unfamiliar.includes(f))
    return block(
      [
        '[overeager-staging-guard] Blocked: bare `git commit` would sweep in files this session did not touch:',
        '',
        ...unfamiliar.slice(0, 20).map(f => `    ${f}`),
        ...(unfamiliar.length > 20
          ? [`    ... and ${unfamiliar.length - 20} more`]
          : []),
        '',
        '  Likely a parallel Claude session staged these — a bare commit',
        '  would include them under your authorship.',
        '',
        '  Fix: commit ONLY your files by pathspec (ignores the rest of',
        '  the index, parallel-session-safe):',
        touchedStaged.length
          ? `    git commit -o ${touchedStaged.slice(0, 8).join(' ')}${touchedStaged.length > 8 ? ' …' : ''}`
          : '    git commit -o path/to/your-file.ts',
        '',
        '  Bypass (only if you genuinely mean to commit the whole index):',
        '    user types "Allow index-sweep bypass" in chat, then retry.',
      ].join('\n'),
    )
  }

  return undefined
}

export const check = bashGuard(checkCommand)

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
