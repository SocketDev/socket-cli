#!/usr/bin/env node
// Claude Code Stop hook — adversarial-review-nudge.
//
// Fires when the assistant's most-recent turn treats a clean automated
// review (a review bot reporting no findings) as a review verdict, with no
// evidence that an adversarial self-review ran. A clean bot pass is one
// reviewer shape finding nothing — absence of findings, not evidence of
// absence. The nudge points at the adversarial self-review loop:
// independent reviewers with distinct lenses prompted to REFUTE, findings
// verified against live behavior (not speculation), rounds iterated until
// one adds nothing load-bearing (each round attacks what the previous
// round's fixes introduced), and one consolidated record (adopted /
// accepted / refuted) posted at the end.
//
// Reminder-only. A clean bot pass can genuinely end the work (a docs-only
// diff, a mechanical rename). Blocking would punish the legitimate cases;
// the nudge makes skipping adversarial review a decision instead of a
// default.
//
// Detection model:
//   - Reads the last assistant turn's text (code fences stripped).
//   - Fires when a review-bot token and a clean-verdict token appear in
//     the same sentence-ish window (either order).
//   - Suppressed when the same turn carries adversarial-review evidence:
//     refute/adversarial/red-team language in the prose, or a spawned
//     reviewer agent (Task/Agent tool use whose prompt reads as a review).

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  readLastAssistantText,
  readLastAssistantToolUses,
  stripCodeFences,
} from '../_shared/transcript.mts'

// Review-bot tokens. Deliberately narrow — "bot" alone would fire on any
// sentence pairing an unrelated bot with the word "clean".
const BOT_TOKEN = String.raw`(?:bug\s?bot|copilot|auto[- ]?review\w*|automated review\w*|review bots?|bot review(?:er)?s?|ai review\w*)`

// Clean-verdict tokens: the phrases that read a no-findings pass as done.
const CLEAN_TOKEN = String.raw`(?:no (?:issues?|findings?|comments?|problems?)(?: (?:found|detected|posted|left|reported))?|came? back clean|found nothing|nothing to (?:address|fix|flag|respond to)|clean pass|passed? with no|all (?:green|clear))`

// Same-sentence proximity, both orders. The window stops at sentence
// punctuation and newlines so a bot mention in one paragraph doesn't pair
// with a "clean" three paragraphs later.
const CLEAN_BOT_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`\b${BOT_TOKEN}\b[^.?!\n]{0,80}?\b${CLEAN_TOKEN}\b`,
    'i',
  ),
  new RegExp(
    String.raw`\b${CLEAN_TOKEN}\b[^.?!\n]{0,80}?\b${BOT_TOKEN}\b`,
    'i',
  ),
]

// Prose that shows the adversarial loop is already running (or ran).
const ADVERSARIAL_EVIDENCE_RE =
  /\badversari|\bred[- ]team|\brefut(?:e|ed|ing|ation)\b|devil'?s advocate|\bskeptic/i

// Agent-spawn evidence: a Task/Agent tool call whose prompt or description
// reads as a review. Spawning reviewers IS the adversarial loop starting.
const REVIEWER_PROMPT_RE = /adversar|refut|skeptic|red[- ]team|review/i

export function detectCleanBotClaim(text: string): string | undefined {
  const stripped = stripCodeFences(text)
  for (let i = 0, { length } = CLEAN_BOT_PATTERNS; i < length; i += 1) {
    const match = CLEAN_BOT_PATTERNS[i]!.exec(stripped)
    if (match) {
      return match[0].replace(/\s+/g, ' ').trim().slice(0, 100)
    }
  }
  return undefined
}

export function hasAdversarialEvidence(
  text: string,
  toolUses: ReturnType<typeof readLastAssistantToolUses>,
): boolean {
  if (ADVERSARIAL_EVIDENCE_RE.test(stripCodeFences(text))) {
    return true
  }
  for (let i = 0, { length } = toolUses; i < length; i += 1) {
    const event = toolUses[i]!
    if (event.name !== 'Agent' && event.name !== 'Task') {
      continue
    }
    const prompt = event.input['prompt']
    const description = event.input['description']
    const subagent = event.input['subagent_type']
    const haystack = [prompt, description, subagent]
      .filter(v => typeof v === 'string')
      .join('\n')
    if (haystack && REVIEWER_PROMPT_RE.test(haystack)) {
      return true
    }
  }
  return false
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const text = readLastAssistantText(payload.transcript_path)
  if (!text) {
    return undefined
  }
  const claim = detectCleanBotClaim(text)
  if (!claim) {
    return undefined
  }
  const toolUses = readLastAssistantToolUses(payload.transcript_path)
  if (hasAdversarialEvidence(text, toolUses)) {
    return undefined
  }
  return notify(
    [
      '[adversarial-review-nudge] Clean bot pass treated as a review verdict:',
      '',
      `  "${claim}"`,
      '',
      '  A clean automated pass is one reviewer shape finding nothing —',
      '  absence of findings, not evidence of absence. Before treating the',
      '  change as reviewed, run an adversarial self-review:',
      '',
      '    • independent reviewer agents with distinct lenses, prompted to',
      '      REFUTE the change, not to appraise it',
      '    • every finding verified against live behavior (run it, repro',
      '      it) — speculation is not a finding',
      '    • iterate rounds until one adds nothing load-bearing; each round',
      "      attacks what the previous round's fixes introduced",
      '    • post one consolidated record: adopted / accepted / refuted',
      '',
      '  Doctrine: docs/agents.md/fleet/adversarial-self-review.md',
      '  Skipping is fine for trivial diffs — say so explicitly instead of',
      '  letting the bot silence stand in for review.',
    ].join('\n') + '\n',
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
