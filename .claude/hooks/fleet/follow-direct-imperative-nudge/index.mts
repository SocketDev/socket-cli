#!/usr/bin/env node
// Claude Code Stop hook — follow-direct-imperative-nudge.
//
// Fires when the last USER turn is a bare imperative ("do it", "kill
// it", "land it") AND the most-recent ASSISTANT turn hedged before
// executing — the failure mode CLAUDE.md "Judgment & self-evaluation →
// Direct imperatives" targets: a paragraph weighing trade-offs where
// the response should have been the tool call.
//
// Turn-pair structure (read last user + last assistant, fire on
// trigger+deflection): the trigger is a predicate, not a regex —
// `looksLikeImperative` bounds length + requires an action-verb first
// word + rejects questions, which a regex can't express cleanly.
//
// Informational; never blocks.

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  readLastAssistantText,
  readUserText,
  stripCodeFences,
} from '../_shared/transcript.mts'

// Imperative-command opening verbs/forms. Kept conservative —
// over-matching would trigger the reminder on normal conversation.
const IMPERATIVE_OPENERS = [
  'abort',
  'add',
  'apply',
  'build',
  'cancel',
  'check',
  'close',
  'commit',
  'continue',
  'delete',
  'deploy',
  'do',
  'execute',
  'finish',
  'fix',
  'follow',
  'go',
  'install',
  'just',
  'kill',
  'land',
  "let's",
  'list',
  'merge',
  'now',
  'open',
  'please',
  'push',
  'rebase',
  'redo',
  'remove',
  'rerun',
  'reset',
  'restart',
  'revert',
  'run',
  'show',
  'stop',
  'switch',
  'test',
  'try',
  'undo',
  'use',
]

// True when the text looks like a bare imperative directive (short,
// action-verb-led, no question mark, no long context).
export function looksLikeImperative(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) {
    return false
  }
  const body = trimmed.replace(/^[!,.\s]+/, '')
  // Questions invite analysis — never an imperative.
  if (body.includes('?')) {
    return false
  }
  // Long contextual messages are not bare imperatives.
  const wordCount = body.split(/\s+/).filter(Boolean).length
  if (wordCount > 8) {
    return false
  }
  /* c8 ignore next - split() always returns ≥1 element; [0] is never undefined */
  const firstWord = body.split(/\s+/)[0] ?? ''
  return IMPERATIVE_OPENERS.includes(firstWord)
}

// Urgency markers — the user is telling the assistant to drop everything and
// execute the literal ask immediately. Three signal families: the shouted
// keywords (case-SENSITIVE — "NOW"/"ASAP" in caps carry the urgency; lowercase
// "now" in prose does not), the plain urgency vocabulary (case-insensitive),
// and shout-case (two-plus consecutive ALL-CAPS words of 3+ letters). Per the
// fleet queue discipline, an explicit now/urgent IS the sanctioned redirect
// signal — a NEW ask mid-queue is normally enqueued, but an urgent one pivots.
const URGENCY_CAPS_RE = /\b(?:NOW|ASAP|URGENT)\b/
const URGENCY_WORDS_RE =
  /\b(?:urgent(?:ly)?|immediately|right now|drop everything|this instant)\b/i
const SHOUT_RUN_RE = /\b[A-Z]{3,}(?:\s+[A-Z]{3,})+\b/

export function hasUrgencyMarker(text: string): boolean {
  return (
    URGENCY_CAPS_RE.test(text) ||
    URGENCY_WORDS_RE.test(text) ||
    SHOUT_RUN_RE.test(text)
  )
}

// Deferral markers — the assistant acknowledged the ask but parked it behind
// current work instead of pivoting. Only wrong when the user signaled urgency
// (enqueue-dont-pivot makes queueing the DEFAULT for non-urgent asks), so
// these fire solely on the urgent path.
const DEFERRAL_MARKERS: readonly RegExp[] = [
  /\bi'?ll (?:get|circle) (?:to|back)\b/i,
  /\bafter (?:the|this|that) (?:current|in-?flight|running)\b/i,
  /\bonce (?:the|this|that) (?:current|in-?flight|running|task|workflow)\b/i,
  /\bfirst,? let me finish\b/i,
  /\b(?:added|adding) (?:it|this|that) to the (?:queue|backlog|list)\b/i,
  /\benqueued?\b/i,
  /\bwhen (?:the|this|that) (?:finishes|completes|lands)\b/i,
]

export function hasDeferral(text: string): boolean {
  return DEFERRAL_MARKERS.some(re => re.test(text))
}

// Hedge / re-litigation markers — paragraphs that explain WHY the
// command might not help before (or instead of) the tool call landing.
const HEDGE_MARKERS: readonly RegExp[] = [
  /\bdoesn't help\b/i,
  /\bwon't help\b/i,
  /\bbefore (?:i|we) (?:do that|run|kick|switch|cancel)\b/i,
  /\blet me (?:explain|first|note)\b/i,
  /\b(?:to be clear|just so we'?re clear)\b/i,
  /\bworth (?:checking|confirming|noting)\b/i,
  /\bone thing to (?:note|flag)\b/i,
  /\bthat said\b/i,
  /\bactually,?\s+/i,
  /\b(?:however|but),?\s+(?:that|the|this)\b/i,
  /\bthe in-?flight\b/i,
  /\b(?:caveat|note|important):/i,
]

export function hasHedge(text: string): boolean {
  return HEDGE_MARKERS.some(re => re.test(text))
}

const IMPERATIVE_TRIGGER_LABEL =
  'bare imperative (short, action-verb-led, no question)'
const HEDGE_DEFLECTION_LABEL = 'hedge / re-litigation before executing'
const HEDGE_DEFLECTION_WHY =
  'The response to a bare command should be the tool call, not a paragraph weighing trade-offs. State the intent in one short sentence at most, then run it. If you think the directive is wrong, run it AFTER raising the concern — do not refuse to act. CLAUDE.md → "Judgment & self-evaluation" → Direct imperatives.'

const URGENCY_TRIGGER_LABEL =
  'urgency marker (NOW / urgent / immediately / shout-case)'
const URGENCY_DEFLECTION_LABEL = 'hedge or queue-deferral on an urgent ask'
const URGENCY_DEFLECTION_WHY =
  'An explicit now/urgent/immediately IS the sanctioned mid-queue redirect: drop the current thread, execute the literal ask first, then resume. Do not park an urgent directive behind in-flight work. CLAUDE.md → "Judgment & self-evaluation" → Direct imperatives + queue discipline.'

export const check = (payload: ToolCallPayload): GuardResult => {
  const userText = stripCodeFences(readUserText(payload.transcript_path, 1))
  const assistantText = stripCodeFences(
    readLastAssistantText(payload.transcript_path),
  )
  if (!userText || !assistantText) {
    return undefined
  }
  const urgent = hasUrgencyMarker(userText)
  const imperative = looksLikeImperative(userText)
  if (!urgent && !imperative) {
    return undefined
  }
  // Urgent asks fire on hedging OR queue-deferral (parking the ask counts as
  // deflection); bare imperatives keep the original hedge-only trigger so the
  // nudge stays conservative on normal conversation.
  const deflected = urgent
    ? hasHedge(assistantText) || hasDeferral(assistantText)
    : hasHedge(assistantText)
  if (!deflected) {
    return undefined
  }
  const userPreview = userText.trim().slice(0, 60).replace(/\s+/g, ' ')
  const triggerLabel = urgent ? URGENCY_TRIGGER_LABEL : IMPERATIVE_TRIGGER_LABEL
  const deflectionLabel = urgent
    ? URGENCY_DEFLECTION_LABEL
    : HEDGE_DEFLECTION_LABEL
  const why = urgent ? URGENCY_DEFLECTION_WHY : HEDGE_DEFLECTION_WHY
  const lines = [
    '[follow-direct-imperative-nudge] User asked, assistant deflected:',
    '',
    `  User trigger: "${triggerLabel}" — "${userPreview}"`,
    `  Assistant deflection: "${deflectionLabel}"`,
    `      ${why}`,
  ]
  return notify(lines.join('\n'))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
