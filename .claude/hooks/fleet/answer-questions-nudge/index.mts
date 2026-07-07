#!/usr/bin/env node
// Claude Code Stop hook — answer-questions-nudge.
//
// Catches the failure mode where the user asks a passing question
// while Claude is mid-task, and Claude brushes past it ("later" /
// "right now I'm doing X" / "let me finish first") instead of
// answering inline.
//
// What triggers:
//   1. The most recent user turn contains a question — `?` punctuation,
//      or interrogative leading ("is", "should", "do we", "would",
//      "can we", "where", "why", "what", "how", "which").
//   2. The most recent assistant turn either (a) contains a deflection
//      phrase or (b) doesn't contain text that looks like an answer
//      (no statement-shape sentence answering the question keywords).
//
// Exception: if the user's question contains an explicit pivot signal
// ("now do X" / "instead let's" / "switch to" / "stop and"), it's not
// a passing question — it's a redirect, and the assistant should
// pivot. The hook skips those.
//

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  readLastAssistantText,
  readUserText,
  stripCodeFences,
} from '../_shared/transcript.mts'

// Phrases that indicate the assistant brushed past the question.
const DEFLECTION_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  {
    label: "right now I'm / right now I am",
    // \bright\s+now\s+ = "right now" word boundary; i'? = optional apostrophe; (?:m|\s+am) = "I'm" or "I am"
    regex: /\bright\s+now\s+i'?(?:m|\s+am)\b/i,
  },
  {
    label: 'let me finish / let me first',
    // (?:let\s+me\s+...|finish\s+first) = "let me {finish|first|wrap}" or "finish first"; outer group unused
    regex: /\b(?:let\s+me\s+(?:finish|first|wrap)|finish\s+first)\b/i,
  },
  {
    label:
      "that's a (structural|bigger|separate) (fix|refactor|question) (for|later)",
    regex:
      // that'?s = "that's"/"thats"; (?:a\s+)? = optional "a "; adjective/noun/disposition alternations non-capturing
      /\bthat'?s\s+(?:a\s+)?(?:structural|bigger|separate|different)\s+(?:fix|refactor|question|issue|concern)\s+(?:for\s+later|though|\.\s)/i,
  },
  {
    label: 'for now / for the moment',
    // \bfor\s+ = "for"; (?:now|the\s+moment) = time phrase; continuation word non-capturing
    regex: /\bfor\s+(?:now|the\s+moment)\s*,?\s+(?:i'?m|let\s+me|focus)/i,
  },
  {
    label: "I'll come back to / get to that",
    // \bi'?ll\s+ = "I'll"; verb phrase and pronoun alternations non-capturing
    regex: /\bi'?ll\s+(?:come\s+back\s+to|get\s+to)\s+(?:that|it|this)\b/i,
  },
  {
    label: 'later — focus / first',
    regex:
      // (?:later|that\s+(?:part|piece)) = deferral noun; [—–-] = em/en/hyphen dash; focus/first/right now
      /\b(?:later|that\s+(?:part|piece))\s*[—–-]\s*(?:focus|first|right\s+now)/i,
  },
  {
    label: 'noted / good question — moving on',
    regex:
      // (?:noted|good\s+...|fair\s+...) = opener; [.—-] = separator; continuation word non-capturing
      /\b(?:noted|good\s+(?:question|catch)|fair\s+(?:point|question))\s*[.—-]\s+(?:moving|continuing|but\s+first)/i,
  },
]

// Patterns that say "the user's input is a redirect, not a passing
// question". If any fires, the hook skips — the assistant SHOULD
// pivot.
const PIVOT_PATTERNS: readonly RegExp[] = [
  // abort/cancel/halt synonyms and "stop and/that" two-word variants
  /\b(?:stop\s+and|stop\s+that|abort|cancel|kill\s+it|halt)\b/i,
  // directional pivot verbs: switch to, pivot to, focus on
  /\b(?:switch\s+to|pivot\s+to|focus\s+on)\b/i,
  // "instead of/do" or "never mind" — negation of current course
  /\b(?:instead\s+(?:of|do)|never\s+mind)\b/i,
  // "do X now" — imperative redirect: leading verb + noun + "now"
  /^\s*(?:do|run|execute|make)\s+\w+\s+now\b/i,
]

// Question-shape detector applied to the most recent user turn.
export function userAsksQuestion(userText: string): boolean {
  // Quick win: explicit question mark.
  if (userText.includes('?')) {
    return true
  }
  // Interrogative leading words at a sentence boundary (allow leading
  // whitespace / punctuation).
  // (?:^|[.\n!]) = sentence start; \s* = optional space; (?:is|are|...) = interrogative word list
  const interrogativeLead =
    /(?:^|[.\n!])\s*(?:is|are|was|were|do|does|did|will|would|should|shall|can|could|may|might|have|has|had|where|why|what|how|which|when|who)\b/i
  return interrogativeLead.test(userText)
}

export const check = (payload: ToolCallPayload): GuardResult => {
  // Read only the MOST RECENT user turn (n=1).
  const recentUser = readUserText(payload.transcript_path, 1).trim()
  if (!recentUser) {
    return undefined
  }
  if (!userAsksQuestion(recentUser)) {
    return undefined
  }
  // If the user's input is a redirect, the assistant should pivot;
  // skip the hook.
  for (let i = 0, { length } = PIVOT_PATTERNS; i < length; i += 1) {
    if (PIVOT_PATTERNS[i]!.test(recentUser)) {
      return undefined
    }
  }

  const rawAssistant = readLastAssistantText(payload.transcript_path)
  if (!rawAssistant) {
    return undefined
  }
  const text = stripCodeFences(rawAssistant)

  // Does the assistant turn contain a deflection phrase?
  const hits: Array<{ label: string; snippet: string }> = []
  for (let i = 0, { length } = DEFLECTION_PATTERNS; i < length; i += 1) {
    const pattern = DEFLECTION_PATTERNS[i]!
    const match = pattern.regex.exec(text)
    if (!match) {
      continue
    }
    const start = Math.max(0, match.index - 30)
    const end = Math.min(text.length, match.index + match[0].length + 50)
    hits.push({
      label: pattern.label,
      snippet: text.slice(start, end).replace(/\s+/g, ' ').trim(),
    })
  }
  if (hits.length === 0) {
    return undefined
  }

  const userSnippet = recentUser.slice(0, 200).replace(/\s+/g, ' ').trim()
  const lines = [
    '[answer-questions-nudge] User asked a passing question; assistant turn brushed past it without answering:',
    '',
    `  User: "${userSnippet}${recentUser.length > 200 ? '…' : ''}"`,
    '',
    '  Deflection phrases detected in assistant turn:',
  ]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    lines.push(`    • "${hit.label}" — …${hit.snippet}…`)
  }
  lines.push('')
  lines.push(
    '  Answer the question inline (one or two sentences) BEFORE / ALONGSIDE the current work. Not every user comment is a pivot — when a question is in passing, lend a few tokens to it. Continue the in-flight work right after.',
  )

  return notify(lines.join('\n'))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
