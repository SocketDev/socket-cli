#!/usr/bin/env node
// Claude Code PreToolUse hook — no-external-issue-ref-guard.
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

import { errorMessage } from '@socketsecurity/lib/errors'

import {
  bypassPhrasePresent,
  readStdin,
} from '../_shared/transcript.mts'

type ToolInput = {
  tool_name?: string | undefined
  tool_input?: { command?: string } | undefined
  transcript_path?: string | undefined
}

const BYPASS_PHRASE = 'Allow external-issue-ref bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

// Commands whose -m / --body / -F arguments end up on a public surface
// where GitHub will auto-link an issue token.
const PUBLIC_MESSAGE_COMMANDS: RegExp[] = [
  /\bgit\s+commit\b/,
  /\bgh\s+pr\s+(create|edit|comment|review)\b/,
  /\bgh\s+issue\s+(create|edit|comment)\b/,
  /\bgh\s+release\s+(create|edit)\b/,
]

// Org allowlist — case-insensitive, but kept lowercase for comparison.
// GitHub treats orgs case-insensitively in URLs and refs, so `socketdev`,
// `SocketDev`, `SOCKETDEV` all resolve to the same org. Storing
// canonical-case here keeps the hook honest about what it accepts.
const ALLOWED_ORGS = new Set<string>(['socketdev'])

// Detect `<owner>/<repo>#<num>` token. Owner and repo names follow
// GitHub's rules: alphanumerics, dashes, underscores, dots (no
// leading dot/dash). We're permissive on the boundaries since we're
// pattern-matching prose, not validating canonical refs.
//
//   (^|\s|\() — anchor at start, whitespace, or open paren. Prevents
//                matching URL fragments that already contain the form
//                (those are matched separately by the URL regex below).
//   ([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?) — owner
//   /
//   ([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?) — repo
//   #
//   (\d+) — issue/PR number
//   (?=\b|[\s.,;:)\]]|$) — terminate cleanly
const OWNER_REPO_REF_RE =
  /(?:^|\s|\()([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)#(\d+)(?=\b|[\s.,;:)\]]|$)/g

// Detect full GitHub issue/PR URLs to non-SocketDev orgs.
const GITHUB_URL_RE =
  /https?:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/(?:issues|pull)\/(\d+)/g

interface ExternalRef {
  kind: 'token' | 'url'
  owner: string
  repo: string
  num: string
  raw: string
}

function isPublicMessageCommand(command: string): boolean {
  const normalized = command.replace(/\s+/g, ' ')
  return PUBLIC_MESSAGE_COMMANDS.some(re => re.test(normalized))
}

/**
 * Extract the textual message body from a shell command. Covers the
 * three common forms:
 *   - `-m "..."` / `-m '...'` (one or more times — git supports it)
 *   - `--message=...` / `--message ...`
 *   - `--body=...` / `--body ...`
 *   - `--body-file=<path>` is NOT inspected (we'd have to read the
 *     file; out of scope, we only check args-as-text)
 *   - HEREDOC bodies: `... -m "$(cat <<'EOF' ... EOF\n)"`. We parse the
 *     literal HEREDOC body when present in the command string.
 *
 * Returns all extracted message bodies joined by newlines so the
 * caller can run one regex pass over the combined text.
 */
function extractMessageBodies(command: string): string {
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
    /(?:^|\s)(?:-m|--message|--body|--body-text)(?:\s+|=)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g
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

/**
 * Strip a single layer of shell quoting from a token. Handles single
 * quotes, double quotes, and unquoted text. We don't attempt full
 * shell-quote unescaping — for the leak we're guarding against, the
 * literal content is what GitHub sees, and any escaped char that's
 * inside `<owner>/<repo>#<num>` would prevent the auto-link anyway.
 */
function unquoteShell(token: string): string {
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

/**
 * Walk the message text and collect every external-org reference.
 * Returns an empty array when the text only references same-repo
 * (`#123`) or SocketDev-owned (`SocketDev/socket-lib#42`) issues.
 */
function findExternalRefs(text: string): ExternalRef[] {
  const out: ExternalRef[] = []

  let m: RegExpExecArray | null
  // Reset regex lastIndex (the regexes are module-scoped /g globals).
  OWNER_REPO_REF_RE.lastIndex = 0
  while ((m = OWNER_REPO_REF_RE.exec(text)) !== null) {
    const owner = m[1]!
    const repo = m[2]!
    const num = m[3]!
    if (!ALLOWED_ORGS.has(owner.toLowerCase())) {
      out.push({
        kind: 'token',
        owner,
        repo,
        num,
        raw: `${owner}/${repo}#${num}`,
      })
    }
  }

  GITHUB_URL_RE.lastIndex = 0
  while ((m = GITHUB_URL_RE.exec(text)) !== null) {
    const owner = m[1]!
    const repo = m[2]!
    const num = m[3]!
    if (!ALLOWED_ORGS.has(owner.toLowerCase())) {
      out.push({
        kind: 'url',
        owner,
        repo,
        num,
        raw: m[0]!,
      })
    }
  }

  return out
}

async function main(): Promise<number> {
  const raw = await readStdin()
  if (!raw.trim()) {
    return 0
  }

  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.stderr.write(
      'no-external-issue-ref-guard: failed to parse stdin payload — fail-open\n',
    )
    return 0
  }

  if (payload.tool_name !== 'Bash') {
    return 0
  }
  const command = payload.tool_input?.command
  if (!command || typeof command !== 'string') {
    return 0
  }
  if (!isPublicMessageCommand(command)) {
    return 0
  }

  const body = extractMessageBodies(command)
  if (!body) {
    return 0
  }

  const refs = findExternalRefs(body)
  if (refs.length === 0) {
    return 0
  }

  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return 0
  }

  // Build the user-facing block message. Group by ref so a single
  // ref repeated three times in a HEREDOC body doesn't print three
  // times.
  const dedup = new Map<string, ExternalRef>()
  for (const r of refs) {
    if (!dedup.has(r.raw)) {
      dedup.set(r.raw, r)
    }
  }
  const lines: string[] = [
    '🚨 no-external-issue-ref-guard: blocked commit/PR/issue message ' +
      'referencing a non-SocketDev GitHub issue or PR.',
    '',
    'Why this matters: GitHub auto-links these tokens and posts an',
    "'added N commits that reference this issue' event back to the",
    "target. A fleet cascade of N commits = N pings to the maintainer.",
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
  process.stderr.write(lines.join('\n') + '\n')
  return 2
}

main().then(
  code => process.exit(code),
  e => {
    process.stderr.write(
      `no-external-issue-ref-guard: hook bug — fail-open. ${errorMessage(e)}\n`,
    )
    process.exit(0)
  },
)
