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
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: unknown | undefined } | undefined
  readonly transcript_path?: string | undefined
}

const ENV_DISABLE = 'SOCKET_OVEREAGER_STAGING_GUARD_DISABLED'
const BYPASS_PHRASES = ['Allow add-all bypass'] as const

export function addTouchedFromBash(
  command: string,
  touched: Set<string>,
): void {
  const segments = command.split(/(?:&&|\|\||;|\n)/)
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const segment = segments[i]!
    const tokens = segment.trim().split(/\s+/)
    let j = 0
    while (j < tokens.length && tokens[j]!.includes('=')) {
      j += 1
    }
    if (tokens[j] !== 'git') {
      continue
    }
    const verb = tokens[j + 1]
    if (verb !== 'add' && verb !== 'mv' && verb !== 'rm') {
      continue
    }
    // Everything after the verb that isn't a flag is a path.
    for (const arg of tokens.slice(j + 2)) {
      if (arg.startsWith('-')) {
        continue
      }
      // Skip the "." / glob forms; those weren't surgical adds.
      if (arg === '.') {
        continue
      }
      touched.add(path.resolve(arg))
    }
  }
}

// Detects `git add` invocations that sweep the working tree. We split
// the command into tokens and check for the flags rather than regexing
// the raw string — that way `git add ./path` (a legitimate surgical
// add of a file that starts with `.`) is not confused with `git add .`
// (the broad sweep).
export function detectBroadGitAdd(command: string): string | undefined {
  // Tokenize on whitespace; not bulletproof against quoted arguments
  // but the broad-add forms never need quoting. Strip trailing
  // semicolons / && / || segments by splitting on those operators.
  const segments = command.split(/(?:&&|\|\||;|\n)/)
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const segment = segments[i]!
    const tokens = segment.trim().split(/\s+/)
    if (tokens.length < 2) {
      continue
    }
    // Find "git add" — tolerate leading env-var sets like
    // `GIT_AUTHOR_NAME=x git add ...`
    let j = 0
    while (j < tokens.length && tokens[j]!.includes('=')) {
      j += 1
    }
    if (tokens[j] !== 'git') {
      continue
    }
    if (tokens[j + 1] !== 'add') {
      continue
    }
    // Inspect remaining args; flag if -A / --all / -u / --update / .
    // appear as a bare positional.
    const rest = tokens.slice(j + 2)
    for (let k = 0, { length } = rest; k < length; k += 1) {
      const arg = rest[k]!
      if (arg === '--all' || arg === '-A') {
        return `git add ${arg}`
      }
      if (arg === '--update' || arg === '-u') {
        return `git add ${arg}`
      }
      if (arg === '.') {
        return 'git add .'
      }
    }
  }
  return undefined
}

export function getRepoDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

export function isGitCommit(command: string): boolean {
  // Tokenize as above; look for "git commit" anywhere in any segment.
  const segments = command.split(/(?:&&|\|\||;|\n)/)
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const segment = segments[i]!
    const tokens = segment.trim().split(/\s+/)
    let j = 0
    while (j < tokens.length && tokens[j]!.includes('=')) {
      j += 1
    }
    if (tokens[j] === 'git' && tokens[j + 1] === 'commit') {
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

// Read tool-use history from the transcript. Return the set of file
// paths the agent has Edit/Write'd, plus any `git rm <path>` targets
// the agent has staged this session.
export function readTouchedPaths(
  transcriptPath: string | undefined,
): Set<string> {
  const touched = new Set<string>()
  if (!transcriptPath) {
    return touched
  }
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return touched
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry === null || typeof entry !== 'object') {
      continue
    }
    const msg = (entry as { message?: unknown | undefined }).message
    if (msg === null || typeof msg !== 'object') {
      continue
    }
    const content = (msg as { content?: unknown | undefined }).content
    if (!Array.isArray(content)) {
      continue
    }
    for (let i = 0, { length } = content; i < length; i += 1) {
      const part = content[i]!
      if (part === null || typeof part !== 'object') {
        continue
      }
      const toolName = (part as { name?: unknown | undefined }).name
      const toolInput = (part as { input?: unknown | undefined }).input
      if (typeof toolName !== 'string') {
        continue
      }
      if (toolInput === null || typeof toolInput !== 'object') {
        continue
      }
      const filePath = (toolInput as { file_path?: unknown | undefined })
        .file_path
      if (typeof filePath === 'string' && filePath) {
        // Edit / Write / Read carry file_path; only Edit and Write
        // modify, but tracking Read'd-but-not-edited files as touched
        // is harmless for this heuristic.
        if (toolName === 'Edit' || toolName === 'Write') {
          touched.add(path.resolve(filePath))
        }
      }
      // Bash commands with `git rm <path>` / `git add <path>` also
      // count as touched. Parse the command tokens.
      const command = (toolInput as { command?: unknown | undefined }).command
      if (toolName === 'Bash' && typeof command === 'string') {
        addTouchedFromBash(command, touched)
      }
    }
  }
  return touched
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
