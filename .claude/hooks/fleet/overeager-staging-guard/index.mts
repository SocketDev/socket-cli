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
//   2. WARN on `git commit` when the index contains files the agent
//      has NOT touched this session (via Edit / Write / `git add
//      <path>` / `git rm <path>`). Exits 0 — informational, not a
//      block — but emits a stderr summary listing every unfamiliar
//      staged file so the agent has a chance to spot parallel-session
//      work before the commit goes through.
//
//      Detection heuristic: list staged files, compare against tool-
//      use history in the transcript. Files staged but never touched
//      this session surface as suspicious entries.
//
// Both layers fail open on hook bugs (exit 0 + stderr log).
//
// Bypass:
//   - `Allow add-all bypass` in a recent user turn (case-sensitive,
//     exact match) — disables layer 1 for the next add.
//   - `SOCKET_OVEREAGER_STAGING_GUARD_DISABLED=1` — disables both.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     "transcript_path": "/.../session.jsonl" }

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import process from 'node:process'

import { readTouchedPaths } from '../_shared/foreign-paths.mts'
import { detectBroadGitAdd, findInvocation } from '../_shared/shell-command.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: unknown | undefined } | undefined
  readonly transcript_path?: string | undefined
}

const ENV_DISABLE = 'SOCKET_OVEREAGER_STAGING_GUARD_DISABLED'
const BYPASS_PHRASES = ['Allow add-all bypass'] as const

export function getRepoDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

export function isGitCommit(command: string): boolean {
  return findInvocation(command, { binary: 'git', subcommand: 'commit' })
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
  if (process.env[ENV_DISABLE]) {
    process.exit(0)
  }
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

  // ── Layer 2: warn on `git commit` if index has unfamiliar files ──
  if (isGitCommit(command)) {
    const staged = listStagedFiles(repoDir)
    if (staged.length === 0) {
      process.exit(0)
    }
    const touched = readTouchedPaths(transcriptPath)
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
    // Don't block — commits with pre-staged content can be legitimate.
    // Just print a loud stderr warning so the agent inspects before
    // proceeding (and humans reviewing the session can spot the slip).
    process.stderr.write(
      [
        '[overeager-staging-guard] ⚠ git commit about to sweep in files this session has not touched:',
        '',
        ...unfamiliar.slice(0, 20).map(f => `    ${f}`),
        ...(unfamiliar.length > 20
          ? [`    ... and ${unfamiliar.length - 20} more`]
          : []),
        '',
        '  Likely cause: a parallel Claude session staged these. The',
        '  commit will include them under your authorship.',
        '',
        '  If unintended, abort and run:',
        '    git restore --staged <file>     # to drop one file',
        '    git reset HEAD                  # to drop everything',
        '',
        '  If intended, proceed — this is informational, not a block.',
      ].join('\n') + '\n',
    )
    process.exit(0)
  }

  process.exit(0)
}

main().catch(e => {
  process.stderr.write(
    `[overeager-staging-guard] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
  )
  process.exit(0)
})
