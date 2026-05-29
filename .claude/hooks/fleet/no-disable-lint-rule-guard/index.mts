#!/usr/bin/env node
// Claude Code PreToolUse hook — no-disable-lint-rule-guard.
//
// Blocks Edit/Write operations that ADD a `"rule-name": "off"` (or
// "warn") entry to any oxlint or .eslintrc config file. The fleet
// rule is: fix the underlying code, don't weaken the gate. Genuine
// single-call-site exemptions belong in a `oxlint-disable-next-line
// <rule> -- <reason>` comment on the violating line.
//
// Trigger surface (filename match, anywhere in the path):
//   - oxlintrc.json
//   - oxlintrc.dogfood.json
//   - any *oxlintrc*.json
//   - .eslintrc, .eslintrc.json, .eslintrc.js, eslint.config.*
//
// Detection: compare old vs new content. If new_string adds a string
// matching /"<rule-name>": "off"/ (or "warn") that wasn't in
// old_string, block. The check is text-based — works for both Edit
// (old_string + new_string fields) and Write (full file content).
//
// Bypass: `Allow disable-lint-rule bypass` typed verbatim in a
// recent user message.
// Env disable (testing only): SOCKET_NO_DISABLE_LINT_RULE_GUARD_DISABLED=1.
//
// Hook contract:
//   - Reads PreToolUse JSON from stdin.
//   - Exits 0 (allow) or 2 (block + stderr explanation).
//   - Fails open on any internal error.

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface PreToolUsePayload {
  readonly tool_name?: string | undefined
  readonly tool_input?:
    | {
        readonly file_path?: unknown | undefined
        readonly old_string?: unknown | undefined
        readonly new_string?: unknown | undefined
        readonly content?: unknown | undefined
      }
    | undefined
  readonly transcript_path?: string | undefined
}

const ENV_DISABLE = 'SOCKET_NO_DISABLE_LINT_RULE_GUARD_DISABLED'
const BYPASS_PHRASE = 'Allow disable-lint-rule bypass'

// Matches: ESLint configs and oxlint configs by filename, anywhere in path.
const CONFIG_FILE_RE =
  /(?:^|\/)(?:[^/]*oxlintrc[^/]*\.json|\.eslintrc(?:\.[a-z]+)?|eslint\.config\.[a-z]+)$/i

// Matches a rule-off (or rule-warn) entry. Captures the rule name.
const RULE_DISABLE_RE = /"([a-z][a-z0-9/-]+)":\s*"(?:off|warn)"/gi

/**
 * Returns true if `filePath` looks like an oxlint/.eslintrc config file.
 */
export function isLintConfigPath(filePath: string): boolean {
  return CONFIG_FILE_RE.test(filePath)
}

/**
 * Returns the set of rules disabled in `content` (any rule mapped to "off" or
 * "warn").
 */
export function extractDisabledRules(content: string): Set<string> {
  const out = new Set<string>()
  for (const m of content.matchAll(RULE_DISABLE_RE)) {
    const rule = m[1]
    if (rule) {
      out.add(rule)
    }
  }
  return out
}

interface BlockReason {
  readonly addedRules: readonly string[]
  readonly filePath: string
}

/**
 * Given the old and new file content, returns the rules newly mapped to
 * "off"/"warn" in new that weren't in old. Empty array means no weakening was
 * added.
 */
export function newlyDisabledRules(
  oldContent: string,
  newContent: string,
): string[] {
  const oldRules = extractDisabledRules(oldContent)
  const newRules = extractDisabledRules(newContent)
  const added: string[] = []
  for (const rule of newRules) {
    if (!oldRules.has(rule)) {
      added.push(rule)
    }
  }
  return added.toSorted()
}

function getOldNewContent(
  payload: PreToolUsePayload,
): { readonly old: string; readonly next: string } | undefined {
  const input = payload.tool_input
  if (!input) {
    return undefined
  }
  const filePath = typeof input.file_path === 'string' ? input.file_path : ''
  if (payload.tool_name === 'Edit') {
    const oldString =
      typeof input.old_string === 'string' ? input.old_string : ''
    const newString =
      typeof input.new_string === 'string' ? input.new_string : ''
    return { old: oldString, next: newString }
  }
  if (payload.tool_name === 'Write') {
    const next = typeof input.content === 'string' ? input.content : ''
    let old = ''
    if (filePath && existsSync(filePath)) {
      try {
        old = readFileSync(filePath, 'utf8')
      } catch {
        old = ''
      }
    }
    return { old, next }
  }
  return undefined
}

function reportBlock(reason: BlockReason): void {
  const ruleList = reason.addedRules.map(r => `  - ${r}`).join('\n')
  const lines = [
    '[no-disable-lint-rule-guard] Edit weakens lint policy.',
    '',
    `  File: ${reason.filePath}`,
    `  New disables:`,
    ruleList,
    '',
    "  Don't disable rules globally. Fix the underlying code, or use a",
    '  per-line exemption with a reason:',
    '',
    '    // oxlint-disable-next-line <rule> -- <reason>',
    '',
    '  See docs/claude.md/fleet/no-disable-lint-rule.md for the full',
    '  rationale + scoped-override recipe.',
    '',
    `  Bypass: type "${BYPASS_PHRASE}" in a recent message.`,
  ]
  process.stderr.write(lines.join('\n') + '\n')
}

async function main(): Promise<void> {
  if (process.env[ENV_DISABLE]) {
    process.exit(0)
  }
  let payload: PreToolUsePayload
  try {
    const raw = await readStdin()
    payload = JSON.parse(raw) as PreToolUsePayload
  } catch {
    process.exit(0)
  }

  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    process.exit(0)
  }

  const input = payload.tool_input
  if (!input) {
    process.exit(0)
  }
  const filePath = typeof input.file_path === 'string' ? input.file_path : ''
  if (!filePath || !isLintConfigPath(filePath)) {
    process.exit(0)
  }

  const contents = getOldNewContent(payload)
  if (!contents) {
    process.exit(0)
  }

  const added = newlyDisabledRules(contents.old, contents.next)
  if (added.length === 0) {
    process.exit(0)
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    process.exit(0)
  }

  reportBlock({ addedRules: added, filePath })
  process.exit(2)
}

main().catch(() => {
  // Fail open — never wedge operator flow on internal hook errors.
  process.exit(0)
})
