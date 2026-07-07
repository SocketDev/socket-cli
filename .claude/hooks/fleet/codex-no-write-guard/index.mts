#!/usr/bin/env node
// Claude Code PreToolUse hook — codex-no-write-guard.
//
// Per "Codex Usage" rule in opt-in repos (ultrathink today, others future):
// Codex is for advice and assessment ONLY, never code changes. Blocks:
//
//   1. Bash invocations of the `codex` CLI when `--write` or `-w` is passed,
//      or when the prompt contains implementation-intent verbs.
//   2. Agent invocations with `subagent_type: codex:codex-rescue` (or other
//      `codex:*` subagents) when the prompt contains implementation-intent
//      verbs.
//
// Prior incident: Codex added inline asm prefetch causing a 5ms perf
// regression. Codex's output is well-suited for diagnosis but not for code
// changes — the regression patterns are subtle (perf, semantic edge cases)
// that human review catches but Codex doesn't.
//
// Bypass: `Allow codex-write bypass` typed verbatim in a recent user turn.
//
// This hook ships in the wheelhouse template (cascaded everywhere) but is
// wired into `.claude/settings.json` only in opt-in repos. Where unwired,
// it has zero effect.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor, invocationHasFlag } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow codex-write bypass'

// Implementation-intent verb pattern. Conservative — matches verbs that
// signal "make code changes" rather than "diagnose / explain / review".
const WRITE_INTENT_VERBS = [
  'implement',
  'apply',
  'write',
  'add',
  'create',
  'fix',
  'patch',
  'change',
  'edit',
  'rewrite',
  'refactor',
  'update',
  'modify',
]

// Detect a write-intent verb used as an IMPERATIVE directed at Codex — i.e. an
// instruction to make changes ("Implement X", "Fix Y", "1. Add Z", "- Patch W")
// — NOT a write verb appearing as subject matter inside a read-only review /
// diagnosis prompt ("inspect the Edit hook", "does it fix stale paths?",
// "commit bodies", "fix-it-don't-defer").
//
// Signal: the verb begins a directive — it sits at the start of the whole text,
// or right after a clause boundary (sentence end, newline, or a list marker
// like `-`, `*`, `1.`), optionally preceded by a polite lead-in ("please ",
// "then "). A bare base-form verb (no -s/-ing/-ed) in that position is an
// imperative; the inflected forms ("fixes", "editing", "updated") are
// descriptive prose and are NOT matched here, which is the common review-prose
// case. The Bash path keeps the broader match on the codex command's own args
// (a CLI prompt arg is itself the instruction, so any occurrence counts there).
const IMPERATIVE_LEAD = String.raw`(?:^|[.!?\n]|(?:^|\n)\s*(?:[-*]|\d+\.)\s*)\s*(?:please\s+|then\s+|now\s+|also\s+)?`

export function hasWriteIntent(text: string): string | undefined {
  const lower = text.toLowerCase()
  for (let i = 0, { length } = WRITE_INTENT_VERBS; i < length; i += 1) {
    const verb = WRITE_INTENT_VERBS[i]!
    // Base-form verb at a directive position, followed by a space (it takes an
    // object) — the shape of an instruction, not a mid-sentence mention.
    const re = new RegExp(`${IMPERATIVE_LEAD}${verb}\\s`, 'm')
    if (re.test(lower)) {
      return verb
    }
  }
  return undefined
}

// Broad match (verb anywhere, any inflection) — used ONLY on a codex CLI
// command's own prompt arg, where the entire arg IS the instruction so a
// descriptive-vs-imperative distinction doesn't apply.
export function hasWriteIntentInArg(text: string): string | undefined {
  const lower = text.toLowerCase()
  for (let i = 0, { length } = WRITE_INTENT_VERBS; i < length; i += 1) {
    const verb = WRITE_INTENT_VERBS[i]!
    const re = new RegExp(`\\b${verb}(?:s|ing|ed)?\\b`)
    if (re.test(lower)) {
      return verb
    }
  }
  return undefined
}

export function isCodexBashCommand(command: string): boolean {
  // Parser-based: the binary at a command position is exactly `codex`.
  // Rejects `codex-no-write-guard` (a path/identifier, not the binary) and
  // a quoted "codex …" inside an arg to another command — both of which
  // the old `codex\b` regex wrongly matched.
  return commandsFor(command, 'codex').length > 0
}

export function blockMessage(blocked: {
  kind: 'bash' | 'agent'
  reason: string
}): string {
  return [
    '[codex-no-write-guard] Blocked: Codex used for code changes',
    '',
    `  Mode:   ${blocked.kind} (${blocked.reason})`,
    '',
    '  Per "Codex Usage" rule: Codex is for advice and assessment ONLY,',
    '  never code changes. Prior incident: Codex added inline asm prefetch',
    '  causing a 5ms perf regression — subtle perf bugs that human review',
    '  catches but Codex misses.',
    '',
    '  Use Codex for:',
    '    - Diagnosis ("why is X slow / failing?")',
    '    - Review ("is this design sound?")',
    '    - Explanation ("walk me through this code")',
    '',
    '  Do NOT use Codex for:',
    '    - "Implement / write / add / fix / patch / refactor X"',
    '    - Anything with `--write` or `-w` flags',
    '',
    `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
    '',
  ].join('\n')
}

// Handles both the Bash (`codex` CLI) and Agent (`codex:*` subagent) tool
// paths, so it can't use the single-tool bashGuard/editGuard adapters — it
// inspects `tool_name` directly.
export function check(payload: ToolCallPayload): GuardResult {
  const input = payload.tool_input
  if (!input) {
    return undefined
  }

  let blocked: { kind: 'bash' | 'agent'; reason: string } | undefined

  if (payload.tool_name === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : ''
    const codexCommands = commandsFor(command, 'codex')
    if (codexCommands.length > 0) {
      if (invocationHasFlag(command, 'codex', ['--write', '-w'])) {
        blocked = { kind: 'bash', reason: '--write / -w flag' }
      } else {
        // Check write-intent verbs only in the codex command's OWN args
        // (the prompt), not the whole shell line — so a sibling command
        // or a path containing a verb word doesn't trip the guard.
        const codexArgText = codexCommands.flatMap(c => c.args).join(' ')
        const verb = hasWriteIntentInArg(codexArgText)
        if (verb) {
          blocked = { kind: 'bash', reason: `write-intent verb "${verb}"` }
        }
      }
    }
  } else if (payload.tool_name === 'Agent') {
    // `subagent_type` / `prompt` are Agent-tool fields not on the shared
    // ToolInput shape — read them through an unknown-typed narrow.
    const agentInput = input as {
      readonly subagent_type?: unknown | undefined
      readonly prompt?: unknown | undefined
    }
    const subagent =
      typeof agentInput.subagent_type === 'string'
        ? agentInput.subagent_type
        : ''
    if (/^codex(?::|$)/.test(subagent)) {
      const prompt =
        typeof agentInput.prompt === 'string' ? agentInput.prompt : ''
      const verb = hasWriteIntent(prompt)
      if (verb) {
        blocked = { kind: 'agent', reason: `write-intent verb "${verb}"` }
      }
    }
  }

  if (!blocked) {
    return undefined
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }

  return block(blockMessage(blocked))
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
