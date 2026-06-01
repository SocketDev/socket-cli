#!/usr/bin/env node
// Claude Code PreToolUse hook — commit-message-format-guard.
//
// Validates `git commit -m <msg>` (and `--message=<msg>`) invocations
// against the Conventional Commits 1.0 spec. Two checks:
//
//   1. The first line of the message follows
//        <type>[(scope)][!]: <description>
//      where type ∈ { feat, fix, chore, docs, style, refactor, perf,
//      test, build, ci, revert }, type is lowercase, the colon-space
//      separator is required, and the description is non-empty.
//
//   2. No AI-attribution markers anywhere in the message body
//      ("Generated with Claude", "Co-Authored-By: Claude", 🤖 tag
//      lines, <noreply@anthropic.com>). The Stop-hook companion
//      commit-pr-reminder catches these at draft time; this is the
//      commit-time defense in depth.
//
// Spec: https://www.conventionalcommits.org/en/v1.0.0/
//
// Bypass phrases (one phrase = one commit):
//   - "Allow commit-format bypass"   — type/format issue
//   - "Allow ai-attribution bypass"  — explicit AI-attribution override
//     (rare; mostly for commits that legitimately document the
//     forbidden strings, e.g. a CLAUDE.md edit that quotes them as
//     examples).
//
// Env disable (testing only): SOCKET_COMMIT_MESSAGE_FORMAT_GUARD_DISABLED=1.
//
// Hook contract:
//   - Reads PreToolUse JSON from stdin.
//   - Exits 0 (allow) or 2 (block + stderr explanation).
//   - Fails open on any internal error so the hook never wedges the
//     operator's flow.

import process from 'node:process'

import { AI_ATTRIBUTION_PATTERNS } from '../_shared/ai-attribution.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface PreToolUsePayload {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: unknown | undefined } | undefined
  readonly transcript_path?: string | undefined
  readonly cwd?: string | undefined
}

const ENV_DISABLE = 'SOCKET_COMMIT_MESSAGE_FORMAT_GUARD_DISABLED'
const BYPASS_FORMAT = 'Allow commit-format bypass'
const BYPASS_AI = 'Allow ai-attribution bypass'

const ALLOWED_TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
] as const

const ALLOWED_TYPE_SET: ReadonlySet<string> = new Set(ALLOWED_TYPES)

// Header form: <type>[(scope)][!]: <description>
// - type: lowercase letters
// - optional (scope) in parens
// - optional `!` breaking-change marker
// - `: ` separator (colon + space)
// - non-empty description
const HEADER_RE = /^([a-z]+)(\([^)]+\))?(!)?: (.+)$/


/**
 * True when the command is a `git commit ...` invocation. Tolerates leading
 * `git -c k=v` flags before the subcommand.
 */
export function isGitCommit(command: string): boolean {
  return /\bgit\b(?:\s+-c\s+\S+)*\s+commit(?:\s|$)/.test(command)
}

/**
 * Extract the inline message text from `git commit -m …` / `--message=…` forms.
 * Returns undefined when the command has no inline message (e.g. uses `-F
 * file`, `-e` to open the editor, or neither) — we don't block those forms; the
 * operator's editor or file is responsible.
 *
 * Multiple `-m` flags concatenate with blank-line separators (matching git's
 * behavior); the first line of the joined result is the header.
 */
export function extractCommitMessage(command: string): string | undefined {
  const matches = [
    ...command.matchAll(
      /(?:^|\s)-m\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/g,
    ),
    ...command.matchAll(
      /--message(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/g,
    ),
  ]
  if (matches.length === 0) {
    return undefined
  }
  const pieces = matches.map(m => m[1] ?? m[2] ?? m[3] ?? '')
  return pieces.join('\n\n')
}

/**
 * Result of validating a single message header.
 *
 * - Kind: 'ok' — header passes
 * - Kind: 'no-type' — first line has no `<type>: ` prefix at all
 * - Kind: 'bad-type' — first line has a `<word>: ` prefix but word isn't
 *   lowercase / not in the type set
 * - Kind: 'uppercase-type' — type letters are present but include uppercase
 * - Kind: 'empty-description' — header has `<type>: ` but description is
 *   empty/whitespace
 */
export type HeaderCheck =
  | { kind: 'ok' }
  | { kind: 'no-type'; line: string }
  | { kind: 'bad-type'; line: string; type: string }
  | { kind: 'uppercase-type'; line: string; type: string }
  | { kind: 'empty-description'; line: string; type: string }

export function validateHeader(line: string): HeaderCheck {
  // Quick pre-check: does the line look like a Conventional header at all?
  // We accept any leading word-token before `: ` for diagnosis even if the
  // case is wrong; the strict HEADER_RE then refines.
  const looseMatch = /^([A-Za-z]+)(\([^)]+\))?(!)?:\s*(.*)$/.exec(line)
  if (!looseMatch) {
    return { kind: 'no-type', line }
  }
  const type = looseMatch[1]!
  const desc = looseMatch[4]!
  // Type must be all-lowercase.
  if (type !== type.toLowerCase()) {
    return { kind: 'uppercase-type', line, type }
  }
  // Type must be in the allowed set.
  if (!ALLOWED_TYPE_SET.has(type)) {
    return { kind: 'bad-type', line, type }
  }
  // Strict format check (catches "feat:description" without space, etc.).
  const strictMatch = HEADER_RE.exec(line)
  if (!strictMatch) {
    // The loose pattern matched but the strict one didn't — that means
    // either the `: ` separator is missing the space, or the description
    // is empty.
    if (!desc.trim()) {
      return { kind: 'empty-description', line, type }
    }
    return { kind: 'no-type', line }
  }
  const description = strictMatch[4]!
  if (!description.trim()) {
    return { kind: 'empty-description', line, type }
  }
  return { kind: 'ok' }
}

/**
 * Scan the full message body for AI-attribution markers. Returns the first
 * matching label, or undefined when the message is clean.
 */
export function findAiAttribution(message: string): string | undefined {
  for (let i = 0, { length } = AI_ATTRIBUTION_PATTERNS; i < length; i += 1) {
    const p = AI_ATTRIBUTION_PATTERNS[i]!
    if (p.regex.test(message)) {
      return p.label
    }
  }
  return undefined
}

/**
 * Build a context-appropriate suggestion for an invalid header. We look at the
 * user's input and propose ONE example of a valid replacement based on what
 * they typed.
 */
export function suggestReplacement(check: HeaderCheck): string {
  if (check.kind === 'ok') {
    return ''
  }
  const text = check.line.trim()
  // Lowercase variant: try to recover the intent.
  if (check.kind === 'uppercase-type') {
    return `${check.type.toLowerCase()}: ${text.slice(text.indexOf(':') + 1).trim()}`
  }
  if (check.kind === 'bad-type') {
    // Suggest 'feat' as a generic recoverable type, keep the rest.
    const rest =
      text.slice(text.indexOf(':') + 1).trim() || 'describe the change'
    return `feat: ${rest}`
  }
  if (check.kind === 'empty-description') {
    return `${check.type}: describe the change`
  }
  // no-type: try to fold whatever the user typed into a feat header.
  const words = text.split(/\s+/).filter(Boolean)
  const first = (words[0] ?? '').toLowerCase()
  // If the first word looks like a noun (e.g. "parser", "extension"), use it
  // as a scope and keep the rest as the description.
  if (words.length >= 2 && /^[a-z][a-z0-9-]*$/.test(first)) {
    const rest = words.slice(1).join(' ')
    return `feat(${first}): ${rest}`
  }
  return `feat: ${text || 'describe the change'}`
}

function emitBlock(reason: string, body: string): never {
  process.stderr.write(`[commit-message-format-guard] ${reason}\n\n${body}\n`)
  process.exit(2)
}

async function main(): Promise<void> {
  if (process.env[ENV_DISABLE]) {
    process.exit(0)
  }
  const raw = await readStdin()
  let payload: PreToolUsePayload
  try {
    payload = JSON.parse(raw) as PreToolUsePayload
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command = payload.tool_input?.['command']
  if (typeof command !== 'string') {
    process.exit(0)
  }
  if (!isGitCommit(command)) {
    process.exit(0)
  }
  const message = extractCommitMessage(command)
  if (message === undefined) {
    // No inline message — operator may be using -F file or editor; not our
    // call to enforce here.
    process.exit(0)
  }

  // Header check first.
  const firstLine = message.split('\n')[0] ?? ''
  const header = validateHeader(firstLine)
  if (header.kind !== 'ok') {
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_FORMAT)) {
      // Operator authorized this commit. Still fall through to AI check
      // separately — bypass-format does not authorize AI attribution.
    } else {
      const suggestion = suggestReplacement(header)
      const lines: string[] = []
      if (header.kind === 'no-type') {
        lines.push(`  Missing Conventional Commits header in: "${header.line}"`)
      } else if (header.kind === 'bad-type') {
        lines.push(
          `  Unknown type "${header.type}" in: "${header.line}"`,
          `  Allowed types: ${ALLOWED_TYPES.join(', ')}`,
        )
      } else if (header.kind === 'uppercase-type') {
        lines.push(
          `  Type must be lowercase. Got "${header.type}" in: "${header.line}"`,
        )
      } else if (header.kind === 'empty-description') {
        lines.push(`  Empty description after "${header.type}:" header.`)
      }
      lines.push('')
      lines.push(`  Required format: <type>[(scope)][!]: <description>`)
      lines.push(`  Allowed types  : ${ALLOWED_TYPES.join(', ')}`)
      lines.push(
        `  Spec           : https://www.conventionalcommits.org/en/v1.0.0/`,
      )
      lines.push('')
      lines.push(`  Suggested fix  : ${suggestion}`)
      lines.push('')
      lines.push(`  Bypass: type "${BYPASS_FORMAT}" in a recent message.`)
      emitBlock(
        'Commit message does not match Conventional Commits 1.0.',
        lines.join('\n'),
      )
    }
  }

  // AI-attribution check (independent of the format bypass).
  const aiLabel = findAiAttribution(message)
  if (aiLabel) {
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_AI)) {
      process.exit(0)
    }
    const lines: string[] = []
    lines.push(`  AI-attribution marker found: ${aiLabel}`)
    lines.push('')
    lines.push('  The fleet forbids AI attribution in commit messages and PR')
    lines.push('  descriptions. Remove the offending line(s) and retry.')
    lines.push('')
    lines.push('  Patterns blocked:')
    lines.push('    - "Generated with Claude" / "Generated with Anthropic"')
    lines.push('    - "Co-Authored-By: Claude"')
    lines.push('    - Robot emoji (🤖) tag lines')
    lines.push('    - <noreply@anthropic.com> footer')
    lines.push('')
    lines.push(`  Bypass (rare): type "${BYPASS_AI}" in a recent message.`)
    lines.push('  Use only when a commit legitimately documents the strings')
    lines.push('  (e.g. CLAUDE.md edits that quote them as examples).')
    emitBlock(
      'AI-attribution markers are forbidden in commit messages.',
      lines.join('\n'),
    )
  }

  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
