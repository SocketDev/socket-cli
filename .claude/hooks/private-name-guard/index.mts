#!/usr/bin/env node
// Claude Code PreToolUse hook — private-name guard.
//
// Never blocks. On every Bash command that would publish text to a public
// Git/GitHub surface (git commit, git push, gh pr/issue/api/release write),
// writes a short reminder to stderr so the model re-reads the command with
// the rule freshly in mind:
//
//   No private repos or internal project names in public surfaces.
//   Omit the reference entirely — don't substitute a placeholder.
//
// Exit code is always 0. This is attention priming, not enforcement. The
// model is responsible for applying the rule — the hook just makes sure
// the rule is in the active context at the moment the command is about
// to fire.
//
// Deliberately carries no enumerated denylist. Recognition and replacement
// happen at write time, not via a list of names. A denylist is itself a
// leak — a file named `private-projects.txt` would be the very thing it
// tries to prevent.
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
    '[private-name-guard] This command writes to a public Git/GitHub surface.',
    '  • Re-read the commit message / PR body / comment BEFORE it sends.',
    '  • No private repo names. No internal project codenames. No unreleased',
    '    product names. No internal-only tooling repos absent from the public',
    '    org page. No customer/partner names.',
    '  • Omit the reference entirely. Do not substitute a placeholder — the',
    '    placeholder itself is a tell.',
    '  • If you spot one, cancel and rewrite the text first.',
  ]
  process.stderr.write(lines.join('\n') + '\n')
}

main()
