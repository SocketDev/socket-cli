#!/usr/bin/env node
// Claude Code PreToolUse hook — codex-no-write-guard.
//
// Per "Codex Usage" rule in opt-in repos (ultrathink today, others future):
// Codex is for advice and assessment ONLY, never code changes. Blocks Bash
// invocations of the `codex` CLI when `--write` or `-w` is passed, or when the
// command's own prompt arg carries an implementation-intent verb.
//
// Prior incident: Codex added inline asm prefetch causing a 5ms perf
// regression. Codex's output is well-suited for diagnosis but not for code
// changes — the regression patterns are subtle (perf, semantic edge cases)
// that human review catches but Codex doesn't.
//
// This hook ships in the wheelhouse template (cascaded everywhere) but is
// wired into `.claude/settings.json` only in opt-in repos. Where unwired,
// it has zero effect.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor, invocationHasFlag } from '../_shared/shell-command.mts'

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

// Broad match (verb anywhere, any inflection) — run on the codex CLI command's
// own prompt arg, where the entire arg IS the instruction so a
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

export function blockMessage(reason: string): string {
  return [
    '[codex-no-write-guard] Blocked: Codex used for code changes',
    '',
    `  Mode:   bash (${reason})`,
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
  ].join('\n')
}

// Inspects the `codex` CLI invocation on the Bash tool. The hook matcher is
// Bash-only, so a non-Bash payload never reaches here.
export function check(payload: ToolCallPayload): GuardResult {
  const input = payload.tool_input
  if (!input || payload.tool_name !== 'Bash') {
    return undefined
  }
  const command = typeof input.command === 'string' ? input.command : ''
  const codexCommands = commandsFor(command, 'codex')
  if (codexCommands.length === 0) {
    return undefined
  }
  let reason: string | undefined
  if (invocationHasFlag(command, 'codex', ['--write', '-w'])) {
    reason = '--write / -w flag'
  } else {
    // Check write-intent verbs only in the codex command's OWN args (the
    // prompt), not the whole shell line — so a sibling command or a path
    // containing a verb word doesn't trip the guard.
    const codexArgText = codexCommands.flatMap(c => c.args).join(' ')
    const verb = hasWriteIntentInArg(codexArgText)
    if (verb) {
      reason = `write-intent verb "${verb}"`
    }
  }
  if (!reason) {
    return undefined
  }
  return block(blockMessage(reason))
}

export const hook = defineHook({
  bypass: ['codex-write'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
