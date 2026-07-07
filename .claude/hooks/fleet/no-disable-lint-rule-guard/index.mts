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

import { existsSync, readFileSync } from 'node:fs'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow disable-lint-rule bypass'

// Matches: ESLint configs and oxlint configs by filename, anywhere in path.
const CONFIG_FILE_RE =
  /(?:^|\/)(?:[^/]*oxlintrc[^/]*\.json|\.eslintrc(?:\.[a-z]+)?|eslint\.config\.[a-z]+)$/i

// Matches a rule-off (or rule-warn) entry. Captures the rule name.
const RULE_DISABLE_RE = /"(?<rule>[a-z][a-z0-9/-]+)":\s*"(?:off|warn)"/gi

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
    const rule = m.groups?.rule
    /* c8 ignore next */
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

/**
 * Resolve the old/new file content for an Edit (old_string + new_string) or a
 * Write (on-disk file + content). Returns `undefined` for any other tool shape.
 */
export function getOldNewContent(
  payload: ToolCallPayload,
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

/**
 * Build the block message naming the file + the newly-disabled rules.
 */
export function reportBlock(reason: BlockReason): string {
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
    '  See docs/agents.md/fleet/no-disable-lint-rule.md for the full',
    '  rationale + scoped-override recipe.',
    '',
    `  Bypass: type "${BYPASS_PHRASE}" in a recent message.`,
  ]
  return lines.join('\n')
}

export const check = editGuard((filePath, _content, payload): GuardResult => {
  if (!isLintConfigPath(filePath)) {
    return undefined
  }

  const contents = getOldNewContent(payload)
  if (!contents) {
    return undefined
  }

  const added = newlyDisabledRules(contents.old, contents.next)
  if (added.length === 0) {
    return undefined
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }

  return block(reportBlock({ addedRules: added, filePath }))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
