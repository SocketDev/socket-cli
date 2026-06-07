#!/usr/bin/env node
// Claude Code Stop hook — answer-questions-reminder.
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

// Phrases that indicate the assistant brushed past the question.
const DEFLECTION_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  {
    label: "right now I'm / right now I am",
    regex: /\bright\s+now\s+i'?(m|\s+am)\b/i,
  },
  {
    label: 'let me finish / let me first',
    regex: /\b(let\s+me\s+(finish|first|wrap)|finish\s+first)\b/i,
  },
  {
    label:
      "that's a (structural|bigger|separate) (fix|refactor|question) (for|later)",
    regex:
      /\bthat'?s\s+(a\s+)?(structural|bigger|separate|different)\s+(fix|refactor|question|issue|concern)\s+(for\s+later|though|\.\s)/i,
  },
  {
    label: 'for now / for the moment',
    regex: /\bfor\s+(now|the\s+moment)\s*,?\s+(i'?m|let\s+me|focus)/i,
  },
  {
    label: "I'll come back to / get to that",
    regex: /\bi'?ll\s+(come\s+back\s+to|get\s+to)\s+(that|it|this)\b/i,
  },
  {
    label: 'later — focus / first',
    regex:
      /\b(later|that\s+(part|piece))\s*[—–\-]\s*(focus|first|right\s+now)/i,
  },
  {
    label: 'noted / good question — moving on',
    regex:
      /\b(noted|good\s+(question|catch)|fair\s+(point|question))\s*[.—\-]\s+(moving|continuing|but\s+first)/i,
  },
]

// Patterns that say "the user's input is a redirect, not a passing
// question". If any fires, the hook skips — the assistant SHOULD
// pivot.
const PIVOT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(stop\s+and|stop\s+that|abort|cancel|kill\s+it|halt)\b/i,
  /\b(switch\s+to|pivot\s+to|focus\s+on)\b/i,
  /\b(instead\s+(of|do)|never\s+mind)\b/i,
  // "do X now" — imperative redirect.
  /^\s*(do|run|execute|make)\s+\w+\s+now\b/i,
]

// Question-shape detector applied to the most recent user turn.
function userAsksQuestion(userText: string): boolean {
  // Quick win: explicit question mark.
  if (userText.includes('?')) {
    return true
  }
  // Interrogative leading words at a sentence boundary (allow leading
  // whitespace / punctuation).
  const interrogativeLead =
    /(?:^|[.\n!])\s*(is|are|was|were|do|does|did|will|would|should|shall|can|could|may|might|have|has|had|where|why|what|how|which|when|who)\b/i
  return interrogativeLead.test(userText)
}

async function main(): Promise<void> {
  const payloadRaw = await readStdin()
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    return
  }

  // Read only the MOST RECENT user turn (n=1).
  const recentUser = readUserText(payload.transcript_path, 1).trim()
  if (!recentUser) {
    return
  }
  if (!userAsksQuestion(recentUser)) {
    return
  }
  // If the user's input is a redirect, the assistant should pivot;
  // skip the hook.
  for (let i = 0, { length } = PIVOT_PATTERNS; i < length; i += 1) {
    if (PIVOT_PATTERNS[i]!.test(recentUser)) {
      return
    }
  }

  const rawAssistant = readLastAssistantText(payload.transcript_path)
  if (!rawAssistant) {
    return
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
    return
  }

  const userSnippet = recentUser.slice(0, 200).replace(/\s+/g, ' ').trim()
  const lines = [
    '[answer-questions-reminder] User asked a passing question; assistant turn brushed past it without answering:',
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

  process.stderr.write(lines.join('\n') + '\n')
}

main().catch(() => {
  // Fail-open: never block a session on this hook's own bug.
})
