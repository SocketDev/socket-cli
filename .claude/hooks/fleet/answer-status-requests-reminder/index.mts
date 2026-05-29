#!/usr/bin/env node
// Claude Code Stop hook — answer-status-requests-reminder.
//
// Catches the failure mode where the user explicitly asks for a
// status update on in-flight work and the assistant declines with a
// rate-limiting excuse like "too soon since last check" or "skipping".
//
// User status-request shapes (case-insensitive, applied to most recent
// user turn):
//
//   - "check status"
//   - "status?"
//   - "status update"
//   - "how's it going" / "how's the build" / "how is it"
//   - "what's it doing"
//   - "is it done"
//   - "still running"
//   - "what's happening"
//   - "where are we"
//   - "progress?"
//
// Assistant decline shapes (case-insensitive):
//
//   - "too soon since (last|the last|my last) check"
//   - "skipping"
//   - "not enough time has passed"
//   - "let me wait" / "I'll wait"
//   - "no need to check" / "no point checking"
//   - "polling is wasted" — even though it's true in some contexts,
//     when the user explicitly asks for status, run the check.
//   - "cache hasn't refreshed" / "nothing new to report" (without
//     having actually checked)
//
// When both fire, emit a reminder: when the user explicitly asks for
// a status update, ALWAYS run the check and report what's there. The
// status is what they're asking for; rate-limiting it is gatekeeping.
//
// Disable via SOCKET_ANSWER_STATUS_REQUESTS_REMINDER_DISABLED.

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

// Shapes the user might use to ask for a status update. Applied to
// the most recent user turn ONLY.
const STATUS_REQUEST_PATTERNS: ReadonlyArray<RegExp> = [
  /\bcheck\s+(the\s+)?status\b/i,
  /\bstatus\s*\??\s*$/im,
  /\bstatus\s+(update|check|report|please)\b/i,
  /\bhow'?s\s+(it|the\s+\w+)\s*(going|doing|progressing|coming)\b/i,
  /\bhow\s+is\s+(it|the\s+\w+)\s*(going|doing|progressing|coming)\??/i,
  /\bwhat'?s\s+(it|the\s+\w+)\s+doing\b/i,
  /\bwhat'?s\s+happening\b/i,
  /\bis\s+(it|the\s+\w+)\s+done\b/i,
  /\bstill\s+running\??/i,
  /\bwhere\s+are\s+we\b/i,
  /\bprogress\s*\??$/im,
  /\bany\s+(updates|progress|news)\b/i,
]

// Phrases that indicate the assistant declined / rate-limited the
// status request instead of just running the check.
const DECLINE_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  {
    label: 'too soon / too early',
    regex: /\btoo\s+(soon|early)\b/i,
  },
  {
    label: 'last check ~N (seconds|minutes) ago',
    regex:
      /\b(last|the\s+last|my\s+last)\s+check\s+(was\s+)?[~\d]+\s*\d*\s*(seconds?|minutes?|min|sec|s|m)\s+ago\b/i,
  },
  {
    label: 'skipping',
    regex: /\b(skipping|i'?ll\s+skip|gonna\s+skip|going\s+to\s+skip)\s*[.,]/i,
  },
  {
    label: 'not enough time has passed',
    regex:
      /\b(not\s+enough\s+time|hasn'?t\s+been\s+(long|enough))\s+(has\s+)?(passed|elapsed|gone\s+by)\b/i,
  },
  {
    label: "let me wait / I'll wait / wait a bit",
    regex:
      /\b(let\s+me\s+wait|i'?ll\s+wait|wait\s+(a\s+(bit|moment|few|minute|second)|until))/i,
  },
  {
    label: 'no need to check / no point',
    regex:
      /\b(no\s+(need|point)\s+(to\s+)?(check(ing)?|polling|looking)|nothing\s+(to\s+)?check)\b/i,
  },
  {
    label: 'polling is wasted / pointless',
    regex: /\bpoll(ing)?\s+(is\s+)?(wasted|pointless|moot|unnecessary)\b/i,
  },
  {
    label: 'no change since last check (without checking)',
    regex:
      /\b(no\s+change|nothing\s+new|same\s+as\s+(before|last))\s+since\s+(the\s+)?last\s+(check|update|time)\b/i,
  },
]

async function main(): Promise<void> {
  if (process.env['SOCKET_ANSWER_STATUS_REQUESTS_REMINDER_DISABLED']) {
    return
  }
  const payloadRaw = await readStdin()
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    return
  }

  // Only the MOST RECENT user turn (n=1).
  const recentUser = readUserText(payload.transcript_path, 1).trim()
  if (!recentUser) {
    return
  }

  let askedForStatus = false
  for (let i = 0, { length } = STATUS_REQUEST_PATTERNS; i < length; i += 1) {
    if (STATUS_REQUEST_PATTERNS[i]!.test(recentUser)) {
      askedForStatus = true
      break
    }
  }
  if (!askedForStatus) {
    return
  }

  const rawAssistant = readLastAssistantText(payload.transcript_path)
  if (!rawAssistant) {
    return
  }
  const text = stripCodeFences(rawAssistant)

  const hits: Array<{ label: string; snippet: string }> = []
  for (let i = 0, { length } = DECLINE_PATTERNS; i < length; i += 1) {
    const pattern = DECLINE_PATTERNS[i]!
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
    '[answer-status-requests-reminder] User asked for a status update; assistant declined with rate-limiting excuse:',
    '',
    `  User: "${userSnippet}${recentUser.length > 200 ? '…' : ''}"`,
    '',
    '  Decline phrases detected in assistant turn:',
  ]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    lines.push(`    • "${hit.label}" — …${hit.snippet}…`)
  }
  lines.push('')
  lines.push(
    '  When the user explicitly asks for a status update, RUN the check and report. "Too soon" / "skipping" / "polling is wasted" are gatekeeping — the user already decided the check is worth it. The auto-notification policy (for background tasks the harness tracks) is YOUR optimization, not theirs.',
  )

  process.stderr.write(lines.join('\n') + '\n')
}

main().catch(() => {
  // Fail-open: never block a session on this hook's own bug.
})
