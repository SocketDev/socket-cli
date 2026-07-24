#!/usr/bin/env node
// Claude Code Stop hook — handoff-command-nudge.
//
// When an assistant reply HANDS a command off to the user to run ("go ahead and
// run it", "fire the release workflow", "you can dispatch the publish"), the
// reply MUST include the LITERAL command — a fenced code block or an inline
// `command` span — never a bare allusion. A handoff without the copy-pasteable
// command forces the user to reconstruct it. Codifies the "never just say 'do
// it' — give the exact command" directive (supersedes the always-give-the-
// command auto-memory per "write it to a guard").
//
// NUDGE, never blocks: it fires at Stop time on the last assistant turn's RAW
// text — fences INTACT, because the fenced command is the very signal it checks
// for (unlike reply-prose-nudge, which strips fences before scanning).

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { readLastAssistantTurnText } from '../_shared/transcript.mts'

// An imperative that hands a command to the USER to run. Narrow by design — aimed
// at the user ("go ahead and run", "you can run", "fire the", "dispatch the",
// "trigger the", "kick off", "do it now"), not the assistant narrating its own
// action ("I'll run", "I ran").
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const HANDOFF_RE =
  /\b(?:dispatch the|do it now|fire (?:off )?the|go ahead and run|kick off|run it (?:now|when|yourself)|trigger the|you(?: can| may| need to| should|'ll)? run)\b/i

// A literal command IS present: a fenced code block, an inline `code` span, or a
// command line (leading `$ ` prompt, or a bare tool invocation at line start).
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const COMMAND_RE =
  /```|`[^`\n]+`|^\s*\$ |^\s*(?:bash|cargo|gh|git|node|npm|npx|pnpm|pnpx|sh) /m

// True when the reply hands a command to the user WITHOUT including the literal
// command. Pure — the test drives it directly.
export function handoffMissingCommand(text: string): boolean {
  return HANDOFF_RE.test(text) && !COMMAND_RE.test(text)
}

export const check = async (payload: ToolCallPayload): Promise<GuardResult> => {
  const text = readLastAssistantTurnText(payload.transcript_path)
  if (!text || !handoffMissingCommand(text)) {
    return undefined
  }
  return notify(
    [
      '[handoff-command-nudge] this reply hands a command to the user without the',
      'literal command.',
      '',
      '  You told the user to run / dispatch / fire something but included no',
      '  copy-pasteable command — no fenced block, no `inline` command span.',
      '  Never allude to a command ("do it now", "fire the workflow"); give the',
      '  exact line in a fenced code block so the user can run it verbatim.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
