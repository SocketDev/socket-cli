#!/usr/bin/env node
// Claude Code PreToolUse hook — public-surface reminder.
//
// Never blocks. On every Bash command that would publish text to a public
// Git/GitHub surface (git commit, git push, gh pr/issue/api/release write),
// writes a short reminder to stderr so the model re-reads the command with
// the two rules freshly in mind:
//
//   1. No real customer/company names — ever. Use `Acme Inc` instead.
//   2. No internal work-item IDs or tracker URLs — no `SOC-123`, `ENG-456`,
//      `ASK-789`, `linear.app`, `sentry.io`, etc.
//
// Exit code is always 0. This is attention priming, not enforcement. The
// model is responsible for actually applying the rule — the hook just makes
// sure the rule is in the active context at the moment the command is about
// to fire.
//
// Deliberately carries no list of customer names. Recognition and
// replacement happen at write time, not via enumeration.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash", "tool_input": { "command": "..." } }

import { readFileSync } from 'node:fs'

type ToolInput = {
  tool_name?: string
  tool_input?: {
    command?: string
  }
}

// Commands that can publish content outside the local machine.
// Keep broad — better to remind on an extra read than miss a write.
const PUBLIC_SURFACE_PATTERNS: RegExp[] = [
  /\bgit\s+commit\b/,
  /\bgit\s+push\b/,
  /\bgh\s+pr\s+(create|edit|comment|review)\b/,
  /\bgh\s+issue\s+(create|edit|comment)\b/,
  /\bgh\s+api\b[^|]*-X\s*(POST|PATCH|PUT)\b/i,
  /\bgh\s+release\s+(create|edit)\b/,
]

function isPublicSurface(command: string): boolean {
  const normalized = command.replace(/\s+/g, ' ')
  return PUBLIC_SURFACE_PATTERNS.some(re => re.test(normalized))
}

function main(): void {
  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch {
    return
  }

  let input: ToolInput
  try {
    input = JSON.parse(raw)
  } catch {
    return
  }

  if (input.tool_name !== 'Bash') {
    return
  }
  const command = input.tool_input?.command
  if (!command || typeof command !== 'string') {
    return
  }
  if (!isPublicSurface(command)) {
    return
  }

  const lines = [
    '[public-surface-reminder] This command writes to a public Git/GitHub surface.',
    '  • Re-read the commit message / PR body / comment BEFORE it sends.',
    '  • No real customer or company names — use `Acme Inc`. No exceptions.',
    '  • No internal work-item IDs or tracker URLs (linear.app, sentry.io, SOC-/ENG-/ASK-/etc.).',
    '  • If you spot one, cancel and rewrite the text first.',
  ]
  process.stderr.write(lines.join('\n') + '\n')
}

main()
