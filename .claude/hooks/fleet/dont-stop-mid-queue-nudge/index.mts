#!/usr/bin/env node
// Claude Code Stop hook — dont-stop-mid-queue-nudge.
//
// Flags assistant text that announces stopping or end-of-session when
// the conversation has a non-empty queue of remaining work. Catches
// the failure mode where the assistant finishes ONE item, summarizes
// what's left, and stops — instead of continuing through the queue
// the user already authorized.
//
// What this hook catches (regex on code-fence-stripped text):
//
//   - "Stopping here" / "I'll stop here"
//   - "Honest stopping point" / "natural stopping point"
//   - "Pausing here" / "I'm pausing"
//   - "Session is at a clean stopping point"
//   - "Want me to continue?" / "Should I keep going?"
//   - "What's next?" / "Pick a [next/specific] [item/one]"
//   - "Stopping for this session" / "stop for this session"
//   - "Final session state" / "Session totals"
//   - "Remaining queue:" followed by a non-empty list
//
// Exception: if the user explicitly said "stop" / "pause" / "we're
// done" in a recent message, the assistant is just acknowledging.
// The hook reads recent user turns and skips if any contains those
// signals.
//

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  readLastAssistantText,
  readUserText,
  stripCodeFences,
} from '../_shared/transcript.mts'

const STOP_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  {
    label: 'stopping here / stop here',
    // Matches "stopping here", "I'll stop here", or "I'm stopping".
    regex: /\b(?:stopping here|i'?ll\s+stop\s+here|i'?m\s+stopping)\b/i,
  },
  {
    label: 'honest/natural/clean stopping point',
    // Matches phrases like "clean stopping point", "natural stopping point", "honest stopping point".
    regex: /\b(?:clean|good|honest|natural)\s+stopping\s+point\b/i,
  },
  {
    label: 'pausing here',
    // Matches "pausing here" or "I'm pausing".
    regex: /\b(?:pausing\s+here|i'?m\s+pausing)\b/i,
  },
  {
    label: 'holding here / holding for / holding off',
    // "Holding here." / "Holding for next direction." / "Holding pending
    // your call." — the queue equivalent of "I'll wait for you to say
    // what's next." Pick the next item instead.
    // Matches "holding here/for/off/pending/until", "I'm holding", "I'll hold", or "will hold".
    regex:
      /\b(?:holding\s+(?:for|here|off|pending|until)|i'?m\s+holding|i'?ll\s+hold|will\s+hold)\b/i,
  },
  {
    label: 'waiting for direction / next direction',
    // Matches "waiting for/on your direction/call/etc." or "waiting for you to choose/decide/etc."
    regex:
      /\b(?:waiting\s+(?:for|on)\s+(?:next|the|your)\s+(?:call|decision|direction|go-ahead|input|signal|word)|wait(?:ing)?\s+for\s+(?:you|your)\s+to\s+(?:choose|decide|direct|pick|say|tell))\b/i,
  },
  {
    label: 'ready when you (are) / let me know when',
    // Matches "ready when you are/you're", "let me know when", or "standing by".
    regex:
      /\b(?:ready\s+when\s+you(?:'re|\s+are)|let\s+me\s+know\s+when|standing\s+by)\b/i,
  },
  {
    label: 'want me to continue / should I keep going',
    // Matches "want me to continue", "should I keep going", or "shall I continue" (with optional "?").
    regex:
      /\b(?:want\s+me\s+to\s+continue|should\s+i\s+keep\s+going|shall\s+i\s+continue)\??/i,
  },
  {
    label: "what's next?",
    regex: /\bwhat'?s\s+next\??/i,
  },
  {
    label: 'pick a/the next item',
    // Matches "pick a/one/specific/the/which ... item/one/task" within 30 chars.
    regex:
      /\bpick\s+(?:a|one|specific|the|which)\b[^.?!\n]{0,30}(?:item|one|task)/i,
  },
  {
    label: 'want me to pick / take them in order',
    // Matches "want me to pick", "take them/these/those in order", "which item/one/task first/next", or "should I start with".
    regex:
      /\b(?:want\s+me\s+to\s+pick|take\s+(?:them|these|those)\s+in\s+order|which\s+(?:item|one|task)\s+(?:first|next)|should\s+i\s+start\s+with)\b/i,
  },
  {
    label: 'pick one and continue / one or in order menu',
    regex: /\bpick\s+(?:a|one|the)\s+and\s+continue\b/i,
  },
  {
    label: 'or take them in order',
    regex: /\bor\s+take\s+(?:all|them|these)\s+in\s+order\??/i,
  },
  {
    label: 'stop(ping) for this session',
    // Matches "stopping/stop for this session", "stopping work for this session", or "stop in this session".
    regex:
      /\b(?:stop(?:ping)?|stopping\s+work)\s+(?:for\s+(?:the|this)|in\s+this)\s+session\b/i,
  },
  {
    label: 'session totals / final session state',
    // Matches "session totals", "final session state", or "session summary".
    regex:
      /\b(?:session\s+totals|final\s+session\s+state|session\s+summary)\b/i,
  },
  {
    label: 'remaining queue / open queue (followed by a list)',
    regex: /\b(?:open|remaining)\s+queue\b[^.?!\n]{0,30}:\s*\n?\s*[-*•]/i,
  },
  {
    label: 'turn ends with menu question after listing pending items',
    // Heuristic: the turn contains a bulleted list under a header like
    // "pending", "remaining", "left", "still pending" (signals an
    // open queue), AND the turn's LAST non-empty line is a question.
    // The most common failure: enumerate what's left, then ask the
    // user which one to pick instead of just picking the next item.
    // Window widened to 2000 chars — a long "remaining backlog" table
    // followed by a trailing "…next, or …first?" menu sat past 800.
    // Matches an open-queue header keyword followed by up to 2000 chars and a trailing question mark.
    regex:
      /\b(?:still\s+pending|what'?s\s+left|remaining|still\s+to\s+do|outstanding|pending:)\b[\s\S]{0,2000}\?\s*$/im,
  },
  {
    label: 'deferring work as a follow-up',
    // "X is a follow-up" / "as a follow-up" / "leave it for a follow-up"
    // / "follow-up:" — the queue equivalent of "I'll do it later". A
    // lint/fix/test item in your window is fixed NOW, never deferred to
    // a follow-up (see Fix-it-don't-defer). Pick it up instead.
    regex:
      /\b(?:(?:is|are)\s+a\s+follow-?up|as\s+a\s+follow-?up|leave\s+[^.?!\n]{0,40}(?:as|for|to)\s+(?:a\s+)?(?:follow-?up|later)|defer(?:red)?\s+[^.?!\n]{0,30}follow-?up|follow-?up\s*:)/i,
  },
  {
    label: 'remaining backlog / remaining todos / remaining items',
    // Matches "remaining backlog", "remaining todos", "remaining items", "remaining tasks", or "remaining work".
    regex: /\bremaining\s+(?:backlog|to-?dos?|items|tasks|work)\b/i,
  },
  {
    label: 'NOT done / left undone / left untouched',
    // Enumerating items as "NOT done" / "left untouched" while the queue
    // is open is the deferral failure in different words.
    regex:
      /\b(?:not\s+done|left\s+(?:undone|untouched)|still\s+untouched|deferred\s+to\s+(?:a\s+)?(?:later|follow))\b/i,
  },
  {
    label: 'budget excuse for an unfinished queue',
    // "didn't have budget" / "out of budget" / "budget-constrained" — a
    // resource excuse for leaving the queue unfinished. Keep going; the
    // user can redirect mid-turn.
    regex:
      /\b(?:didn'?t\s+have\s+(?:the\s+)?budget|out\s+of\s+budget|ran\s+(?:low\s+)?(?:out\s+)?of\s+budget|budget[\s-]?(?:constrained|exhausted|crunch|limited?|tight))\b/i,
  },
  {
    label: 'narrated continuation then stopped (continuing X / next I will …)',
    // The narrate-don't-do failure: the turn's CLOSING line promises the next
    // item ("Continuing the queue from …", "next up is …", "I'll pick up …",
    // "proceeding to …", "continuation proceeds from …") and then the turn
    // ENDS — announcing work instead of doing it. At Stop this means: the very
    // next action should have been the WORK, not a restatement of intent. Do it.
    regex:
      /\b(?:continuing\s+(?:the\s+queue|with|from|on|to|by)|next\s+(?:up\s+)?(?:is|i'?ll|i\s+will|will\s+be)\b|i'?ll\s+(?:continue|pick\s+up|proceed|tackle|build|start|drive|knock\s+out|move\s+on|now\s+\w+)|proceeding\s+(?:to|with|from)|continuation\s+(?:proceeds|continues))\b/i,
  },
]

// Signals from the user that genuinely authorize stopping. If any
// recent user turn matches, the hook short-circuits.
const USER_STOP_AUTHORIZATION_RE =
  /\b(?:stop|pause|hold|halt|wait|we'?re\s+done|that'?s\s+enough|enough\s+for\s+(?:now|today)|let'?s\s+stop|let'?s\s+pause)\b/i

export const check = (payload: ToolCallPayload): GuardResult => {
  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const text = stripCodeFences(rawText)

  // Check if any STOP pattern fires.
  const hits: Array<{ label: string; snippet: string }> = []
  for (let i = 0, { length } = STOP_PATTERNS; i < length; i += 1) {
    const pattern = STOP_PATTERNS[i]!
    const match = pattern.regex.exec(text)
    if (!match) {
      continue
    }
    const start = Math.max(0, match.index - 20)
    const end = Math.min(text.length, match.index + match[0].length + 40)
    hits.push({
      label: pattern.label,
      snippet: text.slice(start, end).replace(/\s+/g, ' ').trim(),
    })
  }
  if (hits.length === 0) {
    return undefined
  }

  // Check if the user authorized stopping. Look at the 3 most recent
  // user turns — if any contains a stop signal, the assistant is
  // just acknowledging.
  const recentUserText = readUserText(payload.transcript_path, 3)
  if (USER_STOP_AUTHORIZATION_RE.test(recentUserText)) {
    return undefined
  }

  const lines = [
    '[dont-stop-mid-queue-nudge] Assistant turn announces stopping or asks a menu question without user authorization:',
    '',
  ]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    lines.push(`  • "${hit.label}" — …${hit.snippet}…`)
  }
  lines.push('')
  lines.push(
    '  ⚠  Action for the NEXT turn: do NOT wait for the user to answer.',
  )
  lines.push('      Identify the next item in the queue (or, if the queue is')
  lines.push(
    '      unclear, pick the highest-value remaining item and SAY which',
  )
  lines.push("      one you're picking), then START WORK on it immediately.")
  lines.push('')
  lines.push(
    '  Why: the user gave you a queue ("complete each one," "keep going,"',
  )
  lines.push(
    '  "do them all," "100%," "hammer it out") and asking "what\'s next?"',
  )
  lines.push(
    '  / "pick one or in order?" re-litigates intent already given. Pick',
  )
  lines.push('  and execute; the user can redirect mid-turn if needed.')
  lines.push('')
  lines.push(
    '  Legitimate stops: the user said "stop," "pause," "we\'re done,"',
  )
  lines.push(
    '  "enough for now," or similar. Or you hit a genuine blocker (off-',
  )
  lines.push(
    '  machine action needed, build cycle measured in hours, etc.) and',
  )
  lines.push('  named it concretely.')
  lines.push('')
  return notify(lines.join('\n'))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
