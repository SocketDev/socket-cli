#!/usr/bin/env node
// Claude Code Stop hook — enqueue-dont-pivot-nudge.
//
// The inverse sibling of dont-stop-mid-queue-nudge. That hook catches
// STOPPING mid-queue; this one catches PIVOTING mid-queue — abandoning
// the in-progress task to chase a topic the user just mentioned, when
// the mention was almost certainly an ADD ("put it on the todos"), not
// a redirect.
//
// The failure mode: the user says "also do X" / "we should ship Y" while
// a task is in flight, and the assistant drops the half-done work and
// refocuses on X — instead of TaskCreate'ing X and finishing the current
// task first. The user has said, in so many words, "add as I tell you,
// don't constantly redirect and refocus."
//
// What this catches (regex on the last assistant turn, code-fences
// stripped): the assistant's OWN pivot language —
//
//   - "pivot" / "pivoting to" / "let me pivot"
//   - "switch gears" / "switching gears"
//   - "(re)focus on" / "change/shift (my) focus"
//   - "new directive" / "directive shift" / "major shift"
//   - "this changes the focus" / "changes my focus"
//   - "drop everything" / "set aside the current/in-flight work"
//   - "abandon the/my current/in-flight work" / "supersedes my current"
//
// Short-circuit: if a recent user turn EXPLICITLY authorized a pivot
// ("stop," "drop that," "do this now/first," "urgent," "switch to X,"
// "before you continue," "interrupt your todos," …), the pivot is what
// the user asked for — stay quiet.

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  readLastAssistantText,
  readUserText,
  stripCodeFences,
} from '../_shared/transcript.mts'

export const PIVOT_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  {
    label: 'pivot / pivoting (to / away from)',
    // matches "pivot", "pivoting", "pivoted", "pivots" as a word boundary
    regex: /\bpivot(?:ing|ed|s)?\b/i,
  },
  {
    label: 'switch / switching gears',
    // matches "switch gears", "switching gears", "switched gears"
    regex: /\bswitch(?:ing|ed)?\s+gears\b/i,
  },
  {
    label: 'change / shift / refocus (my) focus',
    regex:
      // matches "change/shift/refocus [my/the/our] focus" in any inflection
      /\b(?:change|changing|shift|shifting|re-?focus(?:ing|ed)?)\s+(?:my\s+|the\s+|our\s+)?focus\b/i,
  },
  {
    label: 'this changes the / my focus',
    // matches "changes the/my/our focus"
    regex: /\bchanges?\s+(?:the|my|our)\s+focus\b/i,
  },
  {
    label: 'new directive / directive shift',
    regex:
      // matches "new [high-priority/urgent/major] directive" or "directive shift/change/pivot"
      /\b(?:new\s+(?:high-priority\s+|urgent\s+|major\s+)?directive|directive\s+(?:shift|change|pivot))\b/i,
  },
  {
    label: 'major shift / change / pivot',
    // matches "major [directive/priority/focus] shift/pivot/change"
    regex:
      /\bmajor\s+(?:directive\s+|priority\s+|focus\s+)?(?:shift|pivot|change)\b/i,
  },
  {
    label: 'drop everything',
    // matches the literal phrase "drop everything"
    regex: /\bdrop\s+everything\b/i,
  },
  {
    label: 'set aside / set down the current/in-flight work',
    regex:
      // matches "set[ting] aside/down [the/my/this] current/in-flight/in-progress"
      /\bset(?:ting)?\s+(?:aside|down)\s+(?:the\s+|my\s+|this\s+)?(?:current|in-?flight|in-?progress)\b/i,
  },
  {
    label: 'abandon the/my current/in-flight work',
    regex:
      // matches "abandon[ing] the/my/this current/in-flight/in-progress/queue/work"
      /\babandon(?:ing)?\s+(?:the|my|this)\s+(?:current|in-?flight|in-?progress|queue|work)\b/i,
  },
  {
    label: 'supersedes / overrides / takes priority over the current work',
    regex:
      // matches "supersedes/overrides/takes priority over my/the current/in-flight/in-progress"
      /\b(?:supersedes?|overrides?|takes?\s+priority\s+over)\s+(?:my|the)\s+(?:current|in-?flight|in-?progress)\b/i,
  },
]

// Recent-user signals that genuinely authorize a pivot/interrupt. If any
// matches, the assistant is doing what it was told — short-circuit.
// matches explicit user directives: stop/halt/drop/urgent/before/switch/pivot/interrupt and variants
export const USER_PIVOT_AUTHORIZATION_RE =
  /\b(?:stop|halt|pause|drop\s+(?:everything|that|it|the\s+current|what)|forget\s+(?:that|the|it|about)|right\s+now|do\s+(?:this|that|it)\s+(?:now|first)|urgent(?:ly)?|asap|immediately|before\s+(?:anything|you\s+continue|that|finishing|moving)|prioritize\s+this|this\s+first|switch\s+to|pivot\s+to|change\s+(?:course|direction|focus)|new\s+(?:top\s+)?priority|interrupt\s+(?:your|the|my))\b/i

/**
 * Find every pivot tell in the assistant text. Returns the matched label +
 * a trimmed snippet around each hit (for a legible nudge). Pure — exported so
 * the matcher set is unit-tested without mocking a transcript file.
 */
export function findPivotHits(
  text: string,
): Array<{ label: string; snippet: string }> {
  const hits: Array<{ label: string; snippet: string }> = []
  for (let i = 0, { length } = PIVOT_PATTERNS; i < length; i += 1) {
    const pattern = PIVOT_PATTERNS[i]!
    const match = pattern.regex.exec(text)
    if (!match) {
      continue
    }
    const start = Math.max(0, match.index - 20)
    const end = Math.min(text.length, match.index + match[0].length + 40)
    hits.push({
      label: pattern.label,
      // collapses runs of whitespace into a single space for a clean snippet
      snippet: text.slice(start, end).replace(/\s+/g, ' ').trim(),
    })
  }
  return hits
}

/**
 * Did a recent user turn explicitly authorize a pivot/interrupt? When true the
 * assistant's pivot is exactly what was asked for, so the hook stays quiet.
 */
export function userAuthorizedPivot(recentUserText: string): boolean {
  return USER_PIVOT_AUTHORIZATION_RE.test(recentUserText)
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const hits = findPivotHits(stripCodeFences(rawText))
  if (hits.length === 0) {
    return undefined
  }
  // The user may have explicitly told the assistant to pivot — check the 3
  // most recent user turns; if so, this is authorized, not a derail.
  if (userAuthorizedPivot(readUserText(payload.transcript_path, 3))) {
    return undefined
  }

  const lines = [
    '[enqueue-dont-pivot-nudge] Assistant turn signals a focus-PIVOT to a newly-mentioned topic without user authorization:',
    '',
  ]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    lines.push(`  • "${hit.label}" — …${hit.snippet}…`)
  }
  lines.push('')
  lines.push(
    '  ⚠  Action for the NEXT turn: do NOT abandon your in-progress work.',
  )
  lines.push(
    '      If the user just handed you a NEW ask, TaskCreate it (enqueue)',
  )
  lines.push(
    '      and FINISH the current in-progress task first, THEN pick it up.',
  )
  lines.push('')
  lines.push(
    '  Why: a new instruction mid-queue is usually an ADD, not a redirect. The',
  )
  lines.push(
    '  user wants new asks queued, not chased — constantly refocusing drops',
  )
  lines.push('  half-done work and re-litigates the task already in flight.')
  lines.push('')
  lines.push(
    '  Legitimate pivots: the user explicitly said "stop," "drop that," "do',
  )
  lines.push(
    '  this now/first," "urgent," "switch to X," "before you continue,"',
  )
  lines.push(
    '  "interrupt your todos," or similar — or the new ask genuinely BLOCKS',
  )
  lines.push('  the current one (name why). Otherwise: enqueue and keep going.')
  lines.push('')
  return notify(lines.join('\n'))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
