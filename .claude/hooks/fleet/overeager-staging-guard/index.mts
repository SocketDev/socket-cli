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

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import process from 'node:process'

import { readSessionTouchedPaths } from '../_shared/foreign-paths.mts'
import {
  commandsFor,
  detectBroadGitAdd,
  findInvocation,
} from '../_shared/shell-command.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: unknown | undefined } | undefined
  readonly transcript_path?: string | undefined
}

const BYPASS_PHRASES = ['Allow add-all bypass'] as const
// Separate phrase for the index-sweep block: it's a different decision from the
// `git add -A` block, so it gets its own bypass.
const COMMIT_SWEEP_BYPASS = ['Allow index-sweep bypass'] as const

export function getRepoDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

export function isGitCommit(command: string): boolean {
  return findInvocation(command, { binary: 'git', subcommand: 'commit' })
}

// True when a `git commit` carries an explicit pathspec — the parallel-safe
// form, because `git commit <paths>` / `-o`/`--only <paths>` commits ONLY those
// paths regardless of what else is in the index. Detect: any positional arg
// after `commit` (a path), or `-o`/`--only`, or a `--` separator. Flags that
// take a value (`-m msg`, `-F file`, `--author=…`, etc.) must not be mistaken
// for a pathspec, so positionals are only counted after a `--`, or via the
// explicit `-o`/`--only` flag (the unambiguous signals).
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
    if (rest.some(a => a === '-o' || a === '--only')) {
      return true
    }
  }
  return false
}

export function listStagedFiles(repoDir: string): string[] {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: repoDir,
    timeout: 5_000,
  })
  if (r.status !== 0) {
    return []
  }
  return String(r.stdout)
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean)
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command = (
    payload.tool_input as { command?: unknown | undefined } | undefined
  )?.command
  if (typeof command !== 'string' || !command.trim()) {
    process.exit(0)
  }

  const repoDir = getRepoDir()
  const transcriptPath = payload.transcript_path

  // ── Layer 1: block `git add -A` / `.` / `-u` ─────────────────────
  const broad = detectBroadGitAdd(command)
  if (broad) {
    // Fleet-sync sentinel: cascade scripts run `git add -u` inside a
    // worktree they just created off origin/main — no parallel-session
    // hazard because the worktree is empty otherwise. Same opt-in
    // sentinel the no-revert-guard recognizes (`FLEET_SYNC=1` prefix).
    if (/(?:^|\s)FLEET_SYNC\s*=\s*1\b/.test(command)) {
      process.exit(0)
    }
    if (
      transcriptPath &&
      bypassPhrasePresent(transcriptPath, BYPASS_PHRASES, 3)
    ) {
      process.exit(0)
    }
    process.stderr.write(
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
      ].join('\n') + '\n',
    )
    process.exit(2)
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
    if (/(?:^|\s)FLEET_SYNC\s*=\s*1\b/.test(command)) {
      process.exit(0)
    }
    // Pathspec-bearing commit is the safe form — never blocked.
    if (commitHasPathspec(command)) {
      process.exit(0)
    }
    const staged = listStagedFiles(repoDir)
    if (staged.length === 0) {
      process.exit(0)
    }
    const touched = readSessionTouchedPaths(transcriptPath)
    const unfamiliar: string[] = []
    for (let i = 0, { length } = staged; i < length; i += 1) {
      const f = staged[i]!
      const abs = path.resolve(repoDir, f)
      if (!touched.has(abs)) {
        unfamiliar.push(f)
      }
    }
    if (unfamiliar.length === 0) {
      process.exit(0)
    }
    if (
      transcriptPath &&
      bypassPhrasePresent(transcriptPath, COMMIT_SWEEP_BYPASS, 3)
    ) {
      process.exit(0)
    }
    const touchedStaged = staged.filter(f => !unfamiliar.includes(f))
    process.stderr.write(
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
      ].join('\n') + '\n',
    )
    process.exit(2)
  }

  process.exit(0)
}

main().catch(e => {
  process.stderr.write(
    `[overeager-staging-guard] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
  )
  process.exit(0)
})
