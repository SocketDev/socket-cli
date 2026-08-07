#!/usr/bin/env node
// Claude Code Stop hook — deferred-residue-guard.
//
// A reply that NAMES leftover work has already paid the expensive part: finding
// it. Dropping it there means the next session re-derives the same finding from
// scratch, and in practice the next session is this one — so the work gets done
// anyway, minus the context that made it cheap.
//
// So the choice is do it now, or write it down. This guard blocks turn-end when
// the reply names residue and carries neither: no fix, no follow-up marker.
// Adding `Follow-up:` / `Next:` / `TODO:` / a `- [ ]` item satisfies it, because
// a named follow-up is a handle the next turn can pick up.
//
// Observed: a turn ended with "one known residue I'm not starting another cycle
// for: the @file header is stale" — correct, specific, and immediately lost. It
// cost a whole extra round trip to say "do it or we will forget".
//
// Reads the reply text and nothing else, so rewording always satisfies it
// in-turn and it cannot deadlock against a guard waiting on the tree.
// Bypass: `Allow deferred-residue bypass`.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import {
  readLastAssistantTurnText,
  stripCodeFences,
} from '../_shared/transcript.mts'

import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

const NAME = 'deferred-residue-guard'

// Naming the leftover: the noun a reply reaches for when it has found something
// real and is setting it down.
const RESIDUE_NOUN = String.raw`(?:known )?(?:residue|leftover|loose end|follow[-\s]?up item|stale (?:comment|header|doc|docstring|reference))`

// Declining to act: the verb phrase that sets it down.
const DECLINING = String.raw`(?:not (?:starting|going to|worth|doing)|won['’]t (?:fix|do|touch)|leav(?:e|ing) (?:that|it|this|them)|left (?:for|to) (?:later|another|a future)|someone should|could be (?:fixed|done) later|out of scope for (?:now|this))`

// Either shape counts: naming the residue while declining, or declining in the
// same breath as a residue noun.
export const DEFERRED_RESIDUE_RE = new RegExp(
  `(?:${RESIDUE_NOUN}[^.\\n]{0,160}${DECLINING})|(?:${DECLINING}[^.\\n]{0,160}${RESIDUE_NOUN})`,
  'i',
)

// An explicit handle the next turn can pick up. A markdown task item counts
// because it is actionable and survives a skim; a bare sentence does not.
export const FOLLOW_UP_RE =
  /(?:^|\n)\s*(?:(?:\*\*)?(?:follow[-\s]?ups?|next steps?|next|todo)(?:\*\*)?\s*:|[-*]\s*\[ \])/i

/**
 * The deferral phrase in `replyText`, or undefined when there is none or an
 * explicit follow-up already accompanies it.
 */
export function findUnhandledDeferral(replyText: string): string | undefined {
  const text = stripCodeFences(replyText)
  const match = DEFERRED_RESIDUE_RE.exec(text)
  if (!match) {
    return undefined
  }
  // A named follow-up anywhere in the reply discharges it: the work is written
  // down, which is the whole ask.
  if (FOLLOW_UP_RE.test(text)) {
    return undefined
  }
  return match[0]
}

export const check = async (payload: ToolCallPayload): Promise<GuardResult> => {
  const rawText = readLastAssistantTurnText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const hit = findUnhandledDeferral(rawText)
  if (!hit) {
    return undefined
  }
  return block(
    `[${NAME}] The reply names leftover work and neither fixes nor records it:\n` +
      `  Saw:    “${hit.slice(0, 160)}”\n` +
      `  Rule:   naming it means you already did the expensive part. The next\n` +
      `          session is almost always this one, so it gets done anyway —\n` +
      `          without the context that made it cheap.\n` +
      `  Fix:    do it now (usually smaller than the sentence describing it),\n` +
      `          or add an explicit handle: a \`Follow-up:\` / \`Next:\` line, or\n` +
      `          a \`- [ ]\` item. Bypass: \`Allow deferred-residue bypass\`.`,
  )
}

export const hook = defineHook({
  bypass: ['deferred-residue'],
  check,
  event: 'Stop',
  type: 'guard',
})
void runHook(hook, import.meta.url)
