#!/usr/bin/env node
// Claude Code PreToolUse hook — no-ext-issue-ref-guard.
//
// Blocks `git commit` / `gh pr create` / `gh pr edit` / `gh issue create`
// / `gh issue comment` invocations whose message body references an
// issue or PR in a GitHub repo NOT owned by SocketDev.
//
// The leak: GitHub auto-links any `<owner>/<repo>#<num>` token in a
// commit message and posts an `added N commits that reference this
// issue` event back to the target issue. When the fleet does a
// 12-repo cascade and every commit cites `spencermountain/compromise
// #1203`, the maintainer's issue gets spammed with 12 backrefs.
//
// Allowed:
//   - bare `#123` (resolves against the current repo — no cross-repo leak)
//   - `SocketDev/<repo>#<num>` (same org — fine to ping)
//   - `https://github.com/SocketDev/...` (same org)
//
// Blocked:
//   - `<other-owner>/<repo>#<num>`
//   - `https://github.com/<other-owner>/<repo>/issues/<n>`
//   - `https://github.com/<other-owner>/<repo>/pull/<n>`
//
// Fix path the hook suggests:
//   - In commit messages: omit the ref. Put the link in the PR
//     description prose instead (PR bodies don't backref from commits).
//   - In PR/issue bodies: rewrite the bare `<owner>/<repo>#<n>` token
//     to a masked-link form `[#<n>](https://github.com/...)` — GitHub
//     doesn't backref markdown links the same way.
//
// Bypass: `Allow external-issue-ref bypass`.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash", "tool_input": { "command": "..." } }

// Cross-tree shared matcher (canonical home: .git-hooks/_shared/). The
// SAME source the commit-msg git-stage backstop scans, so the Bash-time
// guard and the commit hook never diverge on what counts as a foreign
// ref.
import { scanExternalIssueRefs } from '../../../../.git-hooks/_shared/external-issue-ref.mts'
import type { ExternalIssueRef } from '../../../../.git-hooks/_shared/external-issue-ref.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import {
  BYPASS_LOOKBACK_USER_TURNS,
  bypassPhrasePresent,
} from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow external-issue-ref bypass'

// Dispatcher pre-flight. The guard can only ever block a PUBLIC_MESSAGE_COMMANDS
// shape: `git commit` (always contains `commit`) or `gh pr|issue|release`
// (always contains `gh`). A payload with neither substring can't match, so the
// dispatcher skips importing this guard. Complete: every PUBLIC_MESSAGE_COMMANDS
// alternative contains one of these.
export const triggers: readonly string[] = ['commit', 'gh']

// Commands whose -m / --body / -F arguments end up on a public surface
// where GitHub will auto-link an issue token.
const PUBLIC_MESSAGE_COMMANDS: RegExp[] = [
  /\bgit\s+commit\b/,
  /\bgh\s+pr\s+(comment|create|edit|review)\b/,
  /\bgh\s+issue\s+(comment|create|edit)\b/,
  /\bgh\s+release\s+(create|edit)\b/,
]

// `<owner>/<repo>#<num>` token + github.com issue/PR URL detection and
// the org allowlist live in the canonical .git-hooks/_shared/helpers.mts
// home (scanExternalIssueRefs) so the Bash-time guard and the commit-msg
// git-stage backstop share one matcher.

/**
 * Extract the textual message body from a shell command. Covers the three
 * common forms:
 *
 * - `-m "..."` / `-m '...'` (one or more times — git supports it)
 * - `--message=...` / `--message ...`
 * - `--body=...` / `--body ...`
 * - `--body-file=<path>` is NOT inspected (we'd have to read the file; out of
 *   scope, we only check args-as-text)
 * - HEREDOC bodies: `... -m "$(cat <<'EOF' ... EOF\n)"`. We parse the literal
 *   HEREDOC body when present in the command string.
 *
 * Returns all extracted message bodies joined by newlines so the caller can run
 * one regex pass over the combined text.
 */
export function extractMessageBodies(command: string): string {
  const out: string[] = []

  // Match -m or --message and capture the following quoted or
  // unquoted token. We have to be tolerant — quoting is shell-
  // sensitive but the hook isn't a shell parser.
  //
  // Patterns:
  //   -m "text with spaces"
  //   -m 'text'
  //   -m text
  //   --message="text"
  //   --message text
  //   --body "..."
  const flagRe =
    /(?:^|\s)(?:--body|--body-text|--message|-m)(?:\s+|=)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g
  let match: RegExpExecArray | null
  while ((match = flagRe.exec(command)) !== null) {
    const raw = match[1]!
    out.push(unquoteShell(raw))
  }

  // HEREDOC bodies. Match `<<'TAG' ... TAG` (single-quoted tag = no
  // shell interpolation, which is the conventional safe form used by
  // the fleet's commit-message HEREDOCs).
  const heredocRe = /<<\s*'([A-Z][A-Z0-9_]*)'([\s\S]*?)^\s*\1\s*$/gm
  while ((match = heredocRe.exec(command)) !== null) {
    out.push(match[2]!)
  }
  // Same for unquoted HEREDOC tags (still common).
  const heredocUnquotedRe = /<<\s*([A-Z][A-Z0-9_]*)\b([\s\S]*?)^\s*\1\s*$/gm
  while ((match = heredocUnquotedRe.exec(command)) !== null) {
    out.push(match[2]!)
  }

  return out.join('\n')
}

export function isPublicMessageCommand(command: string): boolean {
  const normalized = command.replace(/\s+/g, ' ')
  return PUBLIC_MESSAGE_COMMANDS.some(re => re.test(normalized))
}

/**
 * Strip a single layer of shell quoting from a token. Handles single quotes,
 * double quotes, and unquoted text. We don't attempt full shell-quote
 * unescaping — for the leak we're guarding against, the literal content is what
 * GitHub sees, and any escaped char that's inside `<owner>/<repo>#<num>` would
 * prevent the auto-link anyway.
 */
export function unquoteShell(token: string): string {
  if (token.length >= 2) {
    const first = token[0]
    const last = token[token.length - 1]
    if (first === '"' && last === '"') {
      return token.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    if (first === "'" && last === "'") {
      return token.slice(1, -1)
    }
  }
  return token
}

export const check = bashGuard((command, payload) => {
  if (!isPublicMessageCommand(command)) {
    return undefined
  }

  const body = extractMessageBodies(command)
  if (!body) {
    return undefined
  }

  const refs = scanExternalIssueRefs(body)
  if (refs.length === 0) {
    return undefined
  }

  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }

  // Build the user-facing block message. Group by ref so a single
  // ref repeated three times in a HEREDOC body doesn't print three
  // times.
  const dedup = new Map<string, ExternalIssueRef>()
  for (let i = 0, { length } = refs; i < length; i += 1) {
    const r = refs[i]!
    if (!dedup.has(r.raw)) {
      dedup.set(r.raw, r)
    }
  }
  const lines: string[] = [
    '🚨 no-ext-issue-ref-guard: blocked commit/PR/issue message ' +
      'referencing a non-SocketDev GitHub issue or PR.',
    '',
    'Why this matters: GitHub auto-links these tokens and posts an',
    "'added N commits that reference this issue' event back to the",
    'target. A fleet cascade of N commits = N pings to the maintainer.',
    '',
    'Refs found:',
  ]
  for (const r of dedup.values()) {
    lines.push(`  - ${r.raw}`)
  }
  lines.push('')
  lines.push('Fix one of:')
  lines.push('  • Remove the ref from the commit message. Move it to')
  lines.push('    the PR description prose, which does NOT backref.')
  lines.push('  • Rewrite to masked-link form (does NOT auto-link):')
  lines.push('      [#1203](https://github.com/owner/repo/issues/1203)')
  lines.push('  • If the ref IS to a SocketDev-owned repo, write it as')
  lines.push('    `SocketDev/<repo>#<num>` (case-insensitive).')
  lines.push('')
  lines.push(
    `Bypass (the user must type verbatim in a recent turn): \`${BYPASS_PHRASE}\``,
  )
  return block(lines.join('\n'))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
