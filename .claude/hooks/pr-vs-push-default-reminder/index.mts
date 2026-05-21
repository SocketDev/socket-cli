#!/usr/bin/env node
// Claude Code PreToolUse hook — pr-vs-push-default-reminder.
//
// Reminder (NOT a block) on `gh pr create` invocations when the current
// branch is `main` / `master` AND the recent transcript doesn't carry
// an explicit PR directive ("open a PR", "PR this", "make a PR",
// "make a pr").
//
// Per CLAUDE.md "Push policy: push, fall back to PR" — direct push is
// the fleet default; PR is the explicit opt-in. The reminder surfaces
// when the agent is about to open a PR without user-asked-for-PR
// signal, in case `git push` would actually work and a PR is wasted
// work (the user will then have to close the PR).
//
// Skipped when the branch isn't main/master (feature branches always
// PR via the wheelhouse push-fallback policy).

import { spawnSync } from '@socketsecurity/lib-stable/spawn/spawn'
import { readFileSync } from 'node:fs'
import process from 'node:process'

import { readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: string | undefined } | undefined
  readonly transcript_path?: string | undefined
  readonly cwd?: string | undefined
}

// Patterns that signal "I want a PR." Match against the FULL trimmed
// text of any of the last N user turns.
const PR_DIRECTIVE_PATTERNS = [
  /\bopen (?:a |the )?pr\b/i,
  /\bpr this\b/i,
  /\bmake (?:a |the )?pr\b/i,
  /\bcreate (?:a |the )?pr\b/i,
  /\bsend (?:a |the )?pr\b/i,
  /\bpull request\b/i,
]

// Recent user-turn window.
const TURN_WINDOW = 6

export function currentBranch(cwd: string): string | undefined {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    timeout: 5_000,
  })
  if (r.status !== 0) {
    return undefined
  }
  return String(r.stdout).trim()
}

export function hasPrDirective(turns: string[]): boolean {
  for (let i = 0, { length } = turns; i < length; i += 1) {
    const text = turns[i]!
    for (let i = 0, { length } = PR_DIRECTIVE_PATTERNS; i < length; i += 1) {
      const re = PR_DIRECTIVE_PATTERNS[i]!
      if (re.test(text)) {return true}
    }
  }
  return false
}

export function isGhPrCreate(command: string): boolean {
  return /\bgh\s+pr\s+create\b/.test(command)
}

interface TranscriptEntry {
  type?: string | undefined
  message?: { content?: unknown | undefined } | undefined
}

export function readRecentUserTurnTexts(
  transcriptPath: string,
  window: number,
): string[] {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return []
  }
  const turns: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(line) as TranscriptEntry
    } catch {
      continue
    }
    if (entry.type !== 'user') {
      continue
    }
    const c = entry.message?.content
    if (typeof c === 'string') {
      turns.push(c)
    } else if (Array.isArray(c)) {
      turns.push(
        c
          .map(seg =>
            typeof seg === 'string'
              ? seg
              : typeof (seg as { text?: unknown | undefined }).text === 'string'
                ? (seg as { text: string }).text
                : '',
          )
          .join('\n'),
      )
    }
  }
  return turns.slice(-window)
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw) {
    process.exit(0)
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command = payload.tool_input?.command ?? ''
  if (!isGhPrCreate(command)) {
    process.exit(0)
  }

  const cwd = payload.cwd ?? process.cwd()
  const branch = currentBranch(cwd)
  if (!branch || (branch !== 'main' && branch !== 'master')) {
    process.exit(0)
  }

  // On main/master — check whether the user asked for a PR.
  if (!payload.transcript_path) {
    process.exit(0)
  }
  const turns = readRecentUserTurnTexts(payload.transcript_path, TURN_WINDOW)
  if (hasPrDirective(turns)) {
    process.exit(0)
  }

  process.stderr.write(
    [
      '[pr-vs-push-default-reminder] About to open a PR from main',
      '',
      `  Current branch: ${branch}`,
      '  Recent user turns do not contain an explicit PR directive',
      '  ("open a PR", "PR this", "make a PR", "pull request").',
      '',
      '  Per CLAUDE.md "Push policy: push, fall back to PR" — direct',
      '  `git push origin <branch>` is the fleet default. PRs are the',
      '  opt-in. If you opened this PR speculatively, the user will',
      '  have to close it; that wastes their time.',
      '',
      '  Try the direct push first:',
      '',
      `    git push origin ${branch}`,
      '',
      '  Fall back to `gh pr create` only when the push is rejected.',
      '',
      '  Reminder-only; not a block.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

main().catch(e => {
  process.stderr.write(
    `[pr-vs-push-default-reminder] hook error (allowing): ${(e as Error).message}\n`,
  )
})
