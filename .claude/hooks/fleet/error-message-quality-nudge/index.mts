#!/usr/bin/env node
// Claude Code Stop hook — error-message-quality-nudge.
//
// Inspects code blocks the assistant wrote for low-quality error
// message strings. CLAUDE.md "Error messages" rule:
//
//   An error message is UI. The reader should fix the problem from
//   the message alone. Four ingredients in order:
//
//     1. What  — the rule, not the fallout
//     2. Where — exact file/line/key/field/flag
//     3. Saw vs. wanted — the bad value and the allowed shape
//     4. Fix  — one imperative action
//
// What this hook catches: throw statements where the message string
// is only a vague verb/noun without the "what" rule or a specific
// field. E.g. `throw new Error("invalid")` — no rule, no field,
// no fix.
//
// What this hook DOES NOT catch: high-quality messages that happen
// to contain a flagged word as part of a longer message. The check
// is "is the message ONLY this vague phrase" rather than "does it
// contain this word."
//
// Pattern: extract every `throw new <X>Error("…")` or `throw new
// <X>Error(`…`)` from the assistant's code fences, inspect the
// message string, flag if it's <40 chars AND matches a vague-only
// shape.
//

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { findThrowNew } from '../_shared/ast/literals.mts'
import {
  ERROR_CLASS_RE,
  gradeMessage,
} from '../_shared/error-message-quality.mts'
import {
  extractCodeFences,
  readLastAssistantText,
} from '../_shared/transcript.mts'
import type { CodeFence } from '../_shared/transcript.mts'

// The vague-message patterns + grading bar live in the shared
// `_shared/error-message-quality.mts` (VAGUE_MESSAGE_PATTERNS, gradeMessage,
// ERROR_CLASS_RE) so this Stop reminder and the commit-time
// `error-messages-are-thorough` check grade identically. AST-based detection:
// `findThrowNew` walks every `throw new <Ctor>(...)` so an interpolated
// template literal or a string containing the literal text `throw new
// Error("...")` can't fool a regex; the message string is then run through the
// shared `gradeMessage`.

interface MessageFinding {
  readonly errorClass: string
  readonly message: string
  readonly label: string
  readonly hint: string
}

export function gradeMessages(
  codeBlocks: readonly CodeFence[],
): MessageFinding[] {
  const findings: MessageFinding[] = []
  for (
    let bi = 0, { length: blocksLen } = codeBlocks;
    bi < blocksLen;
    bi += 1
  ) {
    const block = codeBlocks[bi]!.body
    const throwSites = findThrowNew(block, ERROR_CLASS_RE)
    for (let i = 0, { length } = throwSites; i < length; i += 1) {
      const site = throwSites[i]!
      const message = (site.message ?? '').trim()
      const grade = gradeMessage(message)
      if (grade) {
        findings.push({
          errorClass: site.ctorName,
          message,
          label: grade.label,
          hint: grade.hint,
        })
      }
    }
  }
  return findings
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const text = readLastAssistantText(payload?.transcript_path)
  if (!text) {
    return undefined
  }
  const codeBlocks = extractCodeFences(text)
  if (codeBlocks.length === 0) {
    return undefined
  }
  const findings = gradeMessages(codeBlocks)
  if (findings.length === 0) {
    return undefined
  }

  const lines = [
    '[error-message-quality-nudge] Vague error messages found:',
    '',
  ]
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    lines.push(`  • throw new ${f.errorClass}("${f.message}")`)
    lines.push(`      Vague: ${f.label}`)
    lines.push(`      ${f.hint}`)
    lines.push('')
  }
  lines.push(
    '  CLAUDE.md "Error messages": (1) What — the rule, not the fallout.',
  )
  lines.push(
    '  (2) Where — exact file/line/key/field. (3) Saw vs. wanted — bad',
  )
  lines.push('  value + allowed shape. (4) Fix — one imperative action. Full')
  lines.push('  guidance: docs/agents.md/error-messages.md.')
  lines.push('')
  return notify(lines.join('\n') + '\n')
}

export const hook = defineHook({
  check,
  event: 'Stop',
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
