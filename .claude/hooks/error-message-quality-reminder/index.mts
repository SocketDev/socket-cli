#!/usr/bin/env node
// Claude Code Stop hook — error-message-quality-reminder.
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
// Disable via SOCKET_ERROR_MESSAGE_QUALITY_REMINDER_DISABLED.

import process from 'node:process'

import {
  extractCodeFences,
  readLastAssistantText,
  readStdin,
} from '../_shared/transcript.mts'
import type { CodeFence } from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

// Vague-only error messages — too short to contain "what / where /
// saw vs. wanted / fix" content. Each pattern matches the WHOLE
// message string (anchored), so longer messages containing these
// words but also a field path or rule are not flagged.
//
// The shape is: a verb or adjective + optional generic noun, with
// no colon (a colon usually signals a field-path prefix like
// "user.email: must be lowercase"), no period sentences, no quoted
// values.
const VAGUE_MESSAGE_PATTERNS: readonly { label: string; regex: RegExp; hint: string }[] = [
  {
    label: 'bare "invalid"',
    regex: /^(invalid|invalid value|invalid input|invalid argument|invalid format)\.?$/i,
    hint: '"Invalid" describes the fallout, not the rule. Say what shape was expected: "must be lowercase", "must match /^[a-z]+$/", "must be one of X / Y / Z".',
  },
  {
    label: 'bare "failed"',
    regex: /^(failed|failure|operation failed|request failed|action failed)\.?$/i,
    hint: '"Failed" describes the symptom. Name what was attempted and what blocked it: "could not write <path>: ENOENT", "fetch <url> returned 503".',
  },
  {
    label: 'bare "error occurred"',
    regex: /^(an? )?error(\s+occurred)?\.?$/i,
    hint: 'The message says nothing the reader can act on. State the rule, the location, the bad value.',
  },
  {
    label: 'bare "something went wrong"',
    regex: /^something went wrong\.?$/i,
    hint: 'Pure filler. CLAUDE.md "Error messages": the reader should fix the problem from the message alone.',
  },
  {
    label: 'bare "unable to X" / "could not X" (verb-only)',
    regex: /^(unable to|could not|cannot|can'?t)\s+\w+\.?$/i,
    hint: 'No object / no reason. "Unable to read" → "could not read <path>: <errno>".',
  },
  {
    label: 'bare "not found"',
    regex: /^(not found|not\s+exist|does not exist|missing)\.?$/i,
    hint: 'Missing what? Where? Say "config file not found: <path>" with the specific path.',
  },
  {
    label: 'bare "bad" / "wrong" / "incorrect"',
    regex: /^(bad|wrong|incorrect|invalid format)(\s+(value|input|argument|format|data))?\.?$/i,
    hint: 'Same as "invalid" — describe the rule the value violated, not how you feel about it.',
  },
]

// Capture every throw expression that constructs a *Error class with
// a string-literal message. Three forms:
//   throw new Error("msg")
//   throw new TypeError('msg')
//   throw new RangeError(`msg`)
//
// Groups: 1 = error class name, 2 = quote char, 3 = message body.
// We require the closing quote to match the opening; multi-line
// template literals work as long as the body is followed by the
// same `quote`. (We intentionally don't try to handle interpolated
// templates with ${...} inside — those messages are dynamic, the
// hook is for static-string violations.)
const THROW_NEW_ERROR_RE = /\bthrow\s+new\s+(\w*Error|TemporalError)\s*\(\s*(['"`])([^'"`\n]{0,200})\2\s*[,)]/g

interface MessageFinding {
  readonly errorClass: string
  readonly message: string
  readonly label: string
  readonly hint: string
}

function gradeMessages(codeBlocks: readonly CodeFence[]): MessageFinding[] {
  const findings: MessageFinding[] = []
  for (let bi = 0, { length: blocksLen } = codeBlocks; bi < blocksLen; bi += 1) {
    const block = codeBlocks[bi]!.body
    // Reset the regex's lastIndex each block (global flag preserves it).
    THROW_NEW_ERROR_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = THROW_NEW_ERROR_RE.exec(block)) !== null) {
      const errorClass = match[1]!
      const message = (match[3] ?? '').trim()
      if (message.length === 0) {
        continue
      }
      // Skip messages that contain a colon (suggests field-path prefix)
      // or a quoted value (suggests "saw vs. wanted" present).
      if (message.includes(':') || message.includes('"') || message.includes('`')) {
        continue
      }
      // Skip long messages — they may have the four ingredients spread
      // across a sentence. The hook targets the trivially-vague cases.
      if (message.length > 40) {
        continue
      }
      for (let pi = 0, { length: patternsLen } = VAGUE_MESSAGE_PATTERNS; pi < patternsLen; pi += 1) {
        const pattern = VAGUE_MESSAGE_PATTERNS[pi]!
        if (pattern.regex.test(message)) {
          findings.push({
            errorClass,
            message,
            label: pattern.label,
            hint: pattern.hint,
          })
          break
        }
      }
    }
  }
  return findings
}

async function main(): Promise<void> {
  const payloadRaw = await readStdin()
  if (process.env['SOCKET_ERROR_MESSAGE_QUALITY_REMINDER_DISABLED']) {
    process.exit(0)
  }
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    process.exit(0)
  }
  const text = readLastAssistantText(payload.transcript_path)
  if (!text) {
    process.exit(0)
  }
  const codeBlocks = extractCodeFences(text)
  if (codeBlocks.length === 0) {
    process.exit(0)
  }
  const findings = gradeMessages(codeBlocks)
  if (findings.length === 0) {
    process.exit(0)
  }

  const lines = [
    '[error-message-quality-reminder] Vague error messages found:',
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
  lines.push(
    '  value + allowed shape. (4) Fix — one imperative action. Full',
  )
  lines.push('  guidance: docs/claude.md/error-messages.md.')
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
