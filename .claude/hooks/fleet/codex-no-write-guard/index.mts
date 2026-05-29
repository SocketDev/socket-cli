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

import process from 'node:process'

import { commandsFor, invocationHasFlag } from '../_shared/shell-command.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?:
    | {
        readonly command?: string | undefined
        readonly subagent_type?: string | undefined
        readonly prompt?: string | undefined
      }
    | undefined
  readonly transcript_path?: string | undefined
}

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

export function hasWriteIntent(text: string): string | undefined {
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

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw) {
    process.exit(0)
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.exit(0)
  }

  const input = payload.tool_input
  if (!input) {
    process.exit(0)
  }

  let blocked: { kind: 'bash' | 'agent'; reason: string } | undefined

  if (payload.tool_name === 'Bash') {
    const command = input.command ?? ''
    const codexCommands = commandsFor(command, 'codex')
    if (codexCommands.length > 0) {
      if (invocationHasFlag(command, 'codex', ['--write', '-w'])) {
        blocked = { kind: 'bash', reason: '--write / -w flag' }
      } else {
        // Check write-intent verbs only in the codex command's OWN args
        // (the prompt), not the whole shell line — so a sibling command
        // or a path containing a verb word doesn't trip the guard.
        const codexArgText = codexCommands.flatMap(c => c.args).join(' ')
        const verb = hasWriteIntent(codexArgText)
        if (verb) {
          blocked = { kind: 'bash', reason: `write-intent verb "${verb}"` }
        }
      }
    }
  } else if (payload.tool_name === 'Agent') {
    const subagent = input.subagent_type ?? ''
    if (/^codex(?::|$)/.test(subagent)) {
      const prompt = input.prompt ?? ''
      const verb = hasWriteIntent(prompt)
      if (verb) {
        blocked = { kind: 'agent', reason: `write-intent verb "${verb}"` }
      }
    }
  }

  if (!blocked) {
    process.exit(0)
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    process.exit(0)
  }

  process.stderr.write(
    [
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
    ].join('\n'),
  )
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(
    `[codex-no-write-guard] hook error (allowing): ${(e as Error).message}\n`,
  )
})
