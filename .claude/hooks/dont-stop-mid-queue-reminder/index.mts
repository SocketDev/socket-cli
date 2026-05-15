#!/usr/bin/env node
// Claude Code Stop hook — dont-stop-mid-queue-reminder.
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
// Disable via SOCKET_DONT_STOP_MID_QUEUE_REMINDER_DISABLED.

import process from 'node:process'

import {
  readLastAssistantText,
  readStdin,
  readUserText,
  stripCodeFences,
} from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

const STOP_PATTERNS: readonly { label: string; regex: RegExp }[] = [
  {
    label: 'stopping here / stop here',
    regex: /\b(stopping here|i'?ll\s+stop\s+here|i'?m\s+stopping)\b/i,
  },
  {
    label: 'honest/natural/clean stopping point',
    regex: /\b(honest|natural|clean|good)\s+stopping\s+point\b/i,
  },
  {
    label: 'pausing here',
    regex: /\b(pausing\s+here|i'?m\s+pausing)\b/i,
  },
  {
    label: 'holding here / holding for / holding off',
    // "Holding here." / "Holding for next direction." / "Holding pending
    // your call." — the queue equivalent of "I'll wait for you to say
    // what's next." Pick the next item instead.
    regex:
      /\b(holding\s+(here|off|for|pending|until)|i'?m\s+holding|i'?ll\s+hold|will\s+hold)\b/i,
  },
  {
    label: 'waiting for direction / next direction',
    regex:
      /\b(waiting\s+(for|on)\s+(your|the|next)\s+(direction|call|input|decision|word|go-ahead|signal)|wait(ing)?\s+for\s+(you|your)\s+to\s+(decide|pick|choose|say|tell|direct))\b/i,
  },
  {
    label: 'ready when you (are) / let me know when',
    regex:
      /\b(ready\s+when\s+you('re|\s+are)|let\s+me\s+know\s+when|standing\s+by)\b/i,
  },
  {
    label: 'want me to continue / should I keep going',
    regex: /\b(want\s+me\s+to\s+continue|should\s+i\s+keep\s+going|shall\s+i\s+continue)\??/i,
  },
  {
    label: "what's next?",
    regex: /\bwhat'?s\s+next\??/i,
  },
  {
    label: 'pick a/the next item',
    regex: /\bpick\s+(a|the|one|which|specific)\b[^.?!\n]{0,30}(item|one|task)/i,
  },
  {
    label: 'want me to pick / take them in order',
    regex: /\b(want\s+me\s+to\s+pick|take\s+(them|these|those)\s+in\s+order|which\s+(one|item|task)\s+(first|next)|should\s+i\s+start\s+with)\b/i,
  },
  {
    label: 'pick one and continue / one or in order menu',
    regex: /\bpick\s+(one|a|the)\s+and\s+continue\b/i,
  },
  {
    label: 'or take them in order',
    regex: /\bor\s+take\s+(them|these|all)\s+in\s+order\??/i,
  },
  {
    label: 'stop(ping) for this session',
    regex: /\b(stop(ping)?|stopping\s+work)\s+(for\s+(this|the)|in\s+this)\s+session\b/i,
  },
  {
    label: 'session totals / final session state',
    regex: /\b(session\s+totals|final\s+session\s+state|session\s+summary)\b/i,
  },
  {
    label: 'remaining queue / open queue (followed by a list)',
    regex: /\b(remaining|open)\s+queue\b[^.?!\n]{0,30}:\s*\n?\s*[-*•]/i,
  },
  {
    label: 'turn ends with menu question after listing pending items',
    // Heuristic: the turn contains a bulleted list under a header like
    // "pending", "remaining", "left", "still pending" (signals an
    // open queue), AND the turn's LAST non-empty line is a question.
    // The most common failure: enumerate what's left, then ask the
    // user which one to pick instead of just picking the next item.
    regex: /\b(still\s+pending|what'?s\s+left|remaining|still\s+to\s+do|outstanding|pending:)\b[\s\S]{0,800}\?\s*$/im,
  },
]

// Signals from the user that genuinely authorize stopping. If any
// recent user turn matches, the hook short-circuits.
const USER_STOP_AUTHORIZATION_RE =
  /\b(stop|pause|hold|halt|wait|we'?re\s+done|that'?s\s+enough|enough\s+for\s+(now|today)|let'?s\s+stop|let'?s\s+pause)\b/i

async function main(): Promise<void> {
  const payloadRaw = await readStdin()
  if (process.env['SOCKET_DONT_STOP_MID_QUEUE_REMINDER_DISABLED']) {
    process.exit(0)
  }
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    process.exit(0)
  }
  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    process.exit(0)
  }
  const text = stripCodeFences(rawText)

  // Check if any STOP pattern fires.
  const hits: { label: string; snippet: string }[] = []
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
    process.exit(0)
  }

  // Check if the user authorized stopping. Look at the 3 most recent
  // user turns — if any contains a stop signal, the assistant is
  // just acknowledging.
  const recentUserText = readUserText(payload.transcript_path, 3)
  if (USER_STOP_AUTHORIZATION_RE.test(recentUserText)) {
    process.exit(0)
  }

  const lines = [
    '[dont-stop-mid-queue-reminder] Assistant turn announces stopping or asks a menu question without user authorization:',
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
  lines.push(
    '      Identify the next item in the queue (or, if the queue is',
  )
  lines.push(
    '      unclear, pick the highest-value remaining item and SAY which',
  )
  lines.push(
    '      one you\'re picking), then START WORK on it immediately.',
  )
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
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
