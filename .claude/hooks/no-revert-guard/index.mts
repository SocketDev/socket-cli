#!/usr/bin/env node
// Claude Code PreToolUse hook — no-revert-guard.
//
// Blocks Bash commands that would revert tracked changes, bypass the
// git/husky hook chain, or otherwise destroy work in flight, unless
// the conversation has authorized the bypass via the canonical phrase
// `Allow <X> bypass` (case-sensitive, exact match).
//
// The bypass-phrase contract:
//   - Revert (git checkout/restore/reset/stash drop/stash pop/clean) →
//       user must type "Allow revert bypass" in a recent user turn.
//   - Hook bypass (--no-verify, DISABLE_PRECOMMIT_*, --no-gpg-sign) →
//       user must type "Allow <X> bypass" where <X> matches the flag
//       (e.g. "Allow no-verify bypass", "Allow lint bypass",
//        "Allow gpg bypass").
//   - Force push (--force / -f to push or push-with-lease) →
//       user must type "Allow force-push bypass".
//
// Phrase scoping: the hook reads the recent user turns from the
// transcript (most recent N user messages). A phrase from a prior
// session does NOT carry over — only the current conversation counts.
//
// Why a hook + a memory + a CLAUDE.md rule: the rule documents the
// policy, the memory keeps the assistant honest across sessions, the
// hook is the actual enforcement at edit time. When Claude tries the
// destructive command, this hook checks the transcript, finds no
// matching authorization phrase, and exits 2 with a stderr message
// telling Claude exactly what the user needs to type. The user then
// makes a deliberate choice instead of Claude inferring intent.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     "transcript_path": "/.../session.jsonl" }
//
// Fails open on hook bugs (exit 0 + stderr log).

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

type ToolInput = {
  tool_input?: { command?: string } | undefined
  tool_name?: string | undefined
  transcript_path?: string | undefined
}

type GuardCheck = {
  // Canonical phrase the user must type to bypass.
  readonly bypassPhrase: string
  // Human-readable label for the rule (logged on rejection).
  readonly label: string
  // Pattern that detects the destructive command.
  readonly pattern: RegExp
}

const CHECKS: readonly GuardCheck[] = [
  {
    bypassPhrase: 'Allow revert bypass',
    label: 'git revert (checkout/restore/reset/stash/clean)',
    // Match destructive git commands. Anchored on `git ` or `git\t`
    // (with optional leading whitespace) so we don't match inside
    // arbitrary strings.
    pattern:
      /(?:^|[\s;&|(`])git\s+(?:checkout\s+(?:--?[a-z]+\s+)*(?:--\s|\S+\s+--\s)|restore(?!\s+--staged\b)|reset\s+--hard|stash\s+(?:drop|pop|clear)|clean\s+-[a-z]*f|rm\s+-r?f?\s)/,
  },
  {
    bypassPhrase: 'Allow no-verify bypass',
    label: 'git --no-verify (skips husky hooks)',
    pattern: /(?:^|\s)--no-verify\b/,
  },
  {
    bypassPhrase: 'Allow gpg bypass',
    label: 'git --no-gpg-sign / commit.gpgsign=false',
    pattern: /(?:--no-gpg-sign|commit\.gpgsign\s*=\s*false)\b/,
  },
  {
    bypassPhrase: 'Allow lint bypass',
    label: 'DISABLE_PRECOMMIT_LINT=1 (skips lint step in husky)',
    pattern: /\bDISABLE_PRECOMMIT_LINT\s*=\s*[1-9]/,
  },
  {
    bypassPhrase: 'Allow test bypass',
    label: 'DISABLE_PRECOMMIT_TEST=1 (skips test step in husky)',
    pattern: /\bDISABLE_PRECOMMIT_TEST\s*=\s*[1-9]/,
  },
  {
    bypassPhrase: 'Allow force-push bypass',
    label: 'git push --force / -f',
    pattern: /(?:^|[\s;&|(`])git\s+push\b[^;&|()`]*\s(?:--force\b|-f\b)/,
  },
]

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buf += chunk
    })
    process.stdin.on('end', () => resolve(buf))
  })
}

/**
 * Read user-text content from the transcript JSONL. Each line is a
 * JSON event; user messages have `role: "user"` (or
 * `type: "user"`/`message.role: "user"` depending on the harness
 * version). Concatenate all user-text content into a single string
 * for phrase matching.
 *
 * Fails silently to empty string on parse errors so the hook stays
 * fail-open per the contract.
 */
function readUserTurns(transcriptPath: string | undefined): string {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return ''
  }
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return ''
  }
  const out: string[] = []
  for (const line of raw.split('\n')) {
    if (!line) {
      continue
    }
    let evt: unknown
    try {
      evt = JSON.parse(line)
    } catch {
      continue
    }
    if (!evt || typeof evt !== 'object') {
      continue
    }
    const e = evt as Record<string, unknown>
    // Variants seen across harness versions:
    //   { role: 'user', content: '...' }
    //   { type: 'user', message: { content: '...' } }
    //   { type: 'user', message: { content: [{ type: 'text', text: '...' }] } }
    const role =
      typeof e['role'] === 'string'
        ? e['role']
        : typeof e['type'] === 'string'
          ? e['type']
          : undefined
    if (role !== 'user') {
      continue
    }
    const message = e['message']
    let content: unknown =
      e['content'] ??
      (message && typeof message === 'object'
        ? (message as Record<string, unknown>)['content']
        : undefined)
    if (typeof content === 'string') {
      out.push(content)
      continue
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>
          if (typeof b['text'] === 'string') {
            out.push(b['text'] as string)
          } else if (typeof b['content'] === 'string') {
            out.push(b['content'] as string)
          }
        } else if (typeof block === 'string') {
          out.push(block)
        }
      }
    }
  }
  return out.join('\n')
}

function emitBlock(
  command: string,
  match: GuardCheck,
  matchedSubstring: string,
): void {
  const lines: string[] = []
  lines.push('[no-revert-guard] Blocked: destructive / hook-bypass command.')
  lines.push(`  Rule:    ${match.label}`)
  lines.push(`  Match:   ${matchedSubstring}`)
  lines.push(`  Command: ${command}`)
  lines.push('')
  lines.push('  This operation either reverts tracked changes or bypasses the')
  lines.push('  fleet hook chain. Both destroy work or skip safety checks.')
  lines.push('')
  lines.push(
    `  To proceed, the user must type the EXACT phrase in a new message:`,
  )
  lines.push(`    ${match.bypassPhrase}`)
  lines.push('')
  lines.push(
    '  The phrase is case-sensitive. Inferring intent from a paraphrase',
  )
  lines.push('  ("go ahead", "skip the hook", "fine") does NOT count.')
  process.stderr.write(lines.join('\n') + '\n')
}

async function main(): Promise<void> {
  const raw = await readStdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }
  if (payload.tool_name !== 'Bash') {
    return
  }
  const command = payload.tool_input?.command ?? ''
  if (!command) {
    return
  }

  // Find the first matching destructive pattern.
  let triggered: { check: GuardCheck; matchedSubstring: string } | undefined
  for (const check of CHECKS) {
    const m = command.match(check.pattern)
    if (m) {
      triggered = { check, matchedSubstring: m[0].trim() }
      break
    }
  }
  if (!triggered) {
    return
  }

  // Look for the canonical bypass phrase in user turns. The match is
  // case-sensitive and substring-based — a paraphrase doesn't count.
  const userText = readUserTurns(payload.transcript_path)
  if (userText.includes(triggered.check.bypassPhrase)) {
    return
  }

  emitBlock(command, triggered.check, triggered.matchedSubstring)
  process.exitCode = 2
}

main().catch(e => {
  // Fail open on hook bugs.
  process.stderr.write(
    `[no-revert-guard] hook error (continuing): ${(e as Error).message}\n`,
  )
})
