#!/usr/bin/env node
// Claude Code Stop hook — plan-review-reminder.
//
// Flags assistant turns that propose a multi-step plan in prose form
// without the structured shape the fleet's "Plan review before
// approval" rule requires: numbered steps, named files, named rules.
//
// What this hook catches:
//
//   - Phrases that announce a plan ("Here's the plan:", "My plan is",
//     "I will:", "Steps:", "Approach:") followed by paragraph prose
//     and NO numbered list within ~20 lines after.
//
//   - Plans that announce fleet-shared edits (CLAUDE.md, hooks/,
//     _shared/) without inviting a second-opinion pass.
//
// Heuristic: this is a soft reminder, not a blocker. False positives
// (a quick informal "my plan: just do X") are expected; the cost is
// a single stderr block that the next turn can ignore.
//
// Disable via SOCKET_PLAN_REVIEW_REMINDER_DISABLED.

import process from 'node:process'

import {
  readLastAssistantText,
  readStdin,
  stripCodeFences,
} from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

// Plan-announcement phrases. Each fires only if the announcement is
// NOT followed (within a window of text) by a numbered list.
const PLAN_PHRASE_RE = /\b(here'?s the plan|my plan is|i will:|approach:|steps:|step 1)\b/i

// Numbered-list shape: "1." or "1)" at line start.
const NUMBERED_LIST_RE = /^\s*1\s*[.)]\s+\S/m

// Fleet-shared resources whose edits should invite a second-opinion pass.
const FLEET_SHARED_RE =
  /\b(CLAUDE\.md|\.claude\/hooks\/|_shared\/|template\/CLAUDE\.md|sync-scaffolding|cascade-tooling)\b/

// Second-opinion-invitation phrases.
const SECOND_OPINION_RE =
  /\b(second[- ]opinion|review (the|this) plan|sanity[- ]check|pair[- ]review|invite a review)\b/i

async function main(): Promise<void> {
  const payloadRaw = await readStdin()
  if (process.env['SOCKET_PLAN_REVIEW_REMINDER_DISABLED']) {
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

  const hits: string[] = []

  // Check 1: plan announcement without numbered list.
  const planMatch = PLAN_PHRASE_RE.exec(text)
  if (planMatch) {
    const afterPlan = text.slice(planMatch.index, planMatch.index + 800)
    if (!NUMBERED_LIST_RE.test(afterPlan)) {
      hits.push(
        'plan announced but no numbered list within 800 chars — ' +
          'per "Plan review before approval", list steps numerically, ' +
          'name files you\'ll touch, name rules you\'ll honor',
      )
    }
  }

  // Check 2: fleet-shared edits without second-opinion invite. The
  // fleet-shared scan runs on rawText, not the code-fence-stripped
  // copy — paths like `template/CLAUDE.md` are usually quoted in
  // backticks and would be stripped otherwise.
  if (FLEET_SHARED_RE.test(rawText) && !SECOND_OPINION_RE.test(text)) {
    // Only fire if it really looks like a plan (rather than just a
    // mention of a fleet path in passing). Check both the raw text
    // (which keeps the I'll context) and the stripped text.
    if (
      PLAN_PHRASE_RE.test(text) ||
      /\b(I'?ll|I will|I'm going to)\b/i.test(rawText)
    ) {
      hits.push(
        'plan touches fleet-shared resources (CLAUDE.md / .claude/hooks/ / ' +
          '_shared/) but does not invite a second-opinion pass — per ' +
          'CLAUDE.md "Plan review before approval", invite review before code',
      )
    }
  }

  if (hits.length === 0) {
    process.exit(0)
  }

  const lines = ['[plan-review-reminder] Plan structure check:', '']
  for (let i = 0, { length } = hits; i < length; i += 1) {
    lines.push(`  • ${hits[i]}`)
  }
  lines.push('')
  lines.push(
    '  See CLAUDE.md "Plan review before approval" — the plan itself is a deliverable.',
  )
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
