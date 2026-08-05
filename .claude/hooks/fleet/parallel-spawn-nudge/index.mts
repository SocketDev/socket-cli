#!/usr/bin/env node
// Claude Code PreToolUse hook — parallel-spawn-nudge.
//
// `agent-prompt-budget-guard` refuses an open-ended brief and caps a scoped one
// at five minutes, so work that used to be one long spawn now has to be split
// into several scoped ones. That split only pays off when the pieces run
// CONCURRENTLY: fired one per turn they cost the same wall-clock as the single
// long spawn they replaced, and nothing checked for that.
//
// Detection: the IMMEDIATELY PRECEDING assistant turn contains exactly ONE
// `Agent`/`Task` tool use, and the current call is another spawn. Exactly one,
// because a prior turn carrying two or more is already the batched shape this
// nudge asks for and must stay silent.
//
// Numbers in the message are measured, not guessed: tight briefs ran 6.4-7.4
// seconds per tool call against 13.6-43.8 for open-ended ones, and every spawn
// pays about 15 seconds of fixed startup.
//
// NUDGE, not guard — a spawn that consumes the previous agent's result is a
// legitimate pipeline, and the hook cannot tell that from the tool payload. The
// message names that exception outright so the reader can dismiss it in one
// beat. Exit code is always 0.
//
// Detail: docs/agents.md/fleet/agent-delegation.md.

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { readPriorAssistantTurnToolUses } from '../_shared/transcript.mts'

// Tool names that spawn a fresh subagent. `SendMessage` resumes an agent that
// already exists, so it is neither a spawn here nor a match for this hook.
export const SPAWN_TOOL_NAMES: readonly string[] = ['Agent', 'Task']

export function isSpawnToolName(toolName: string | undefined): boolean {
  if (!toolName) {
    return false
  }
  for (let i = 0, { length } = SPAWN_TOOL_NAMES; i < length; i += 1) {
    if (SPAWN_TOOL_NAMES[i] === toolName) {
      return true
    }
  }
  return false
}

/**
 * Count the `Agent`/`Task` tool uses inside one assistant turn. Pure.
 */
export function countSpawns(
  events: ReadonlyArray<{ readonly name: string }>,
): number {
  let count = 0
  for (let i = 0, { length } = events; i < length; i += 1) {
    if (isSpawnToolName(events[i]!.name)) {
      count += 1
    }
  }
  return count
}

export const NUDGE_MESSAGE = [
  '[parallel-spawn-nudge] Serial subagent spawns.',
  '',
  '  What:   the previous turn spawned a single agent and this turn spawns',
  '          another one.',
  '  Where:  this Agent/Task call.',
  '  Saw:    one spawn per turn; wanted independent spawns issued together.',
  '  Fix:    if these two agents do not depend on each other, put them in ONE',
  '          message as concurrent tool uses. Every spawn pays ~15 seconds of',
  '          startup either way, but serial spawns also pay each other’s',
  '          full wall-clock on top of that.',
  '',
  '  Exception: if this spawn consumes the previous one’s result, that is a',
  '  pipeline and this nudge does not apply.',
].join('\n')

export function check(payload: ToolCallPayload): GuardResult {
  if (!isSpawnToolName(payload.tool_name)) {
    return undefined
  }
  // Index 0 is the turn right before the one making this call: the walker
  // skips the most-recent assistant turn, which is the current one.
  const priorTurns = readPriorAssistantTurnToolUses(payload.transcript_path, 1)
  const previousTurn = priorTurns[0]
  if (!previousTurn || countSpawns(previousTurn) !== 1) {
    return undefined
  }
  return notify(`${NUDGE_MESSAGE}\n`)
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Task', 'Agent'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
