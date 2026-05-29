#!/usr/bin/env node
// Claude Code PreToolUse hook — scan-label-in-commit-guard.
//
// Blocks `git commit` invocations whose message body contains
// scan-report-internal labels (B1, B2, …, M3, H5, L7). These are
// the scratch-pad IDs the `/scanning-quality` and `/scanning-security`
// skills assign to findings inside a single review session. They have
// no meaning outside that session — a future reader of `git log` who
// doesn't have the original report can't decode "fix B5" or
// "addresses M9".
//
// The right shape is to inline the actual finding text:
//
//   ✗ fix(http-request): B5 download truncation race
//   ✓ fix(http-request/download): settle on fileStream finish, not res end
//
// Detection — the message is sourced from one of:
//   - `git commit -m "<msg>"` (single -m or repeated)
//   - `git commit --message=<msg>`
//   - `git commit -F <file>` / `git commit --file=<file>` — read file
//
// Pattern: case-sensitive `\b[BMHL]\d+\b` as a standalone word.
//   - B1, M9, H3, L4 → flag
//   - 'B' alone, 'B12345' (5+ digits = likely a real ID), 'GHSA-…' → don't flag
//   - Inside fenced code blocks (``` … ```) → don't flag (the operator
//     is quoting test output / SQL / etc.)
//
// Bypass: type "Allow scan-label-in-commit bypass" in a recent user
// message. Use when the label is genuinely meaningful (e.g. citing a
// specific advisory ID that happens to match the shape).
//
// Exit codes:
//   0 — pass.
//   2 — block.
//
// Fails open on malformed payloads (exit 0 + stderr log).

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_input?:
    | {
        readonly command?: string | undefined
      }
    | undefined
  readonly tool_name?: string | undefined
  readonly transcript_path?: string | undefined
  readonly cwd?: string | undefined
}

interface Hit {
  readonly label: string
  readonly line: number
  readonly snippet: string
}

const BYPASS_PHRASE = 'Allow scan-label-in-commit bypass'

// Match standalone scan-report-internal IDs: B/M/H/L (Blocker /
// Medium / High / Low) followed by 1–4 digits. The lookbehind /
// lookahead pair excludes `B12345` (5+ digits) and `GHSA-B1-…` /
// `branch-B12` shapes where a hyphen sits next to the label.
// Case-sensitive — lowercase `b1` is not a report label.
const LABEL_RE = /(?<![A-Za-z0-9_-])[BMHL][0-9]{1,4}(?![A-Za-z0-9_-])/g

/**
 * Strip fenced code blocks from a multi-line message body so we don't flag
 * labels that appear inside quoted log output. Triple-backtick fences only
 * (`````); we don't try to handle indented code blocks.
 */
export function stripFencedCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, '')
}

/**
 * Find scan-label matches in a commit message body. Returns one hit per unique
 * (line, label) pair so the error message can name them all.
 */
export function findScanLabels(body: string): Hit[] {
  const stripped = stripFencedCode(body)
  const hits: Hit[] = []
  const lines = stripped.split('\n')
  const seen = new Set<string>()
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    let m: RegExpExecArray | null
    LABEL_RE.lastIndex = 0
    while ((m = LABEL_RE.exec(line)) !== null) {
      const label = m[0]
      const key = `${i}:${label}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      hits.push({
        label,
        line: i + 1,
        snippet: line.length > 80 ? line.slice(0, 77) + '…' : line,
      })
    }
  }
  return hits
}

/**
 * Pull the commit message from a `git commit …` command line. Returns the
 * message text or `undefined` if the command doesn't carry an inline message
 * (e.g. uses `-e` to open the editor — those messages are reviewed by the
 * operator, no need to flag).
 *
 * Handles `-m "msg"`, `-m msg`, `--message=msg`, `--message msg`, `-F file`,
 * `--file=file`. For file-form invocations, reads the file relative to `cwd`.
 */
export function extractCommitMessage(
  command: string,
  cwd: string,
): string | undefined {
  // Inspect each real `git commit` invocation. The parser strips quotes
  // and scopes args to the command that owns them, so a `-m` inside a
  // sibling command or a quoted body can't leak in.
  for (const c of commandsFor(command, 'git')) {
    if (!c.args.includes('commit')) {
      continue
    }
    const { args } = c
    // Collect every inline message: `-m <msg>`, `--message <msg>`,
    // `--message=<msg>` (repeated -m forms join with a blank line, the
    // same way git concatenates multiple -m paragraphs).
    const messages: string[] = []
    let fileArg: string | undefined
    for (let i = 0, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (arg === '--message' || arg === '-m') {
        const next = args[i + 1]
        if (next !== undefined) {
          messages.push(next)
          i += 1
        }
        continue
      }
      if (arg.startsWith('--message=')) {
        messages.push(arg.slice('--message='.length))
        continue
      }
      if (arg === '--file' || arg === '-F') {
        const next = args[i + 1]
        if (next !== undefined) {
          fileArg = next
          i += 1
        }
        continue
      }
      if (arg.startsWith('--file=')) {
        fileArg = arg.slice('--file='.length)
        continue
      }
    }
    if (messages.length > 0) {
      return messages.join('\n\n')
    }
    if (fileArg !== undefined) {
      const filePath = path.isAbsolute(fileArg)
        ? fileArg
        : path.join(cwd, fileArg)
      if (existsSync(filePath)) {
        try {
          return readFileSync(filePath, 'utf8')
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

function handlePayload(payloadRaw: string): number {
  let payload: ToolInput
  try {
    payload = JSON.parse(payloadRaw) as ToolInput
  } catch {
    return 0
  }
  if (payload.tool_name !== 'Bash') {
    return 0
  }
  const command = payload.tool_input?.command ?? ''
  if (!command) {
    return 0
  }
  const cwd = payload.cwd ?? process.cwd()
  const body = extractCommitMessage(command, cwd)
  if (!body) {
    return 0
  }
  const hits = findScanLabels(body)
  if (hits.length === 0) {
    return 0
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return 0
  }
  const lines: string[] = []
  lines.push(
    '[scan-label-in-commit-guard] Blocked: scan-report-internal label in commit message.',
  )
  lines.push('')
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const h = hits[i]!
    lines.push(`  Line ${h.line}: ${h.label} — "${h.snippet}"`)
  }
  lines.push('')
  lines.push('  Labels like B1 / M9 / H3 / L4 come from /scanning-quality and')
  lines.push('  /scanning-security reports. They are scratch-pad IDs that mean')
  lines.push('  nothing outside the original session — a future reader of')
  lines.push('  `git log` who does not have the report cannot decode them.')
  lines.push('')
  lines.push('  Rewrite the message to inline the actual finding text:')
  lines.push('    ✗ fix(http-request): B5 download truncation race')
  lines.push(
    '    ✓ fix(http-request/download): settle on fileStream finish, not res end',
  )
  lines.push('')
  lines.push('  Bypass (e.g. citing a real advisory ID that happens to match):')
  lines.push(`    Type "${BYPASS_PHRASE}" in your next message.`)
  process.stderr.write(lines.join('\n') + '\n')
  return 2
}

export { handlePayload }

// CLI entrypoint — only fires when this file is the main module. Tests
// import `findScanLabels` / `extractCommitMessage` directly without
// triggering the stdin reader (which would never see an `end` event
// in test env and hang the process).
if (process.argv[1] && process.argv[1].endsWith('index.mts')) {
  let payloadRaw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    payloadRaw += chunk
  })
  process.stdin.on('end', () => {
    try {
      process.exit(handlePayload(payloadRaw))
    } catch (e) {
      process.stderr.write(
        `[scan-label-in-commit-guard] hook error (allowing): ${e}\n`,
      )
      process.exit(0)
    }
  })
}
