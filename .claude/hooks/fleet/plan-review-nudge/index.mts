#!/usr/bin/env node
// Claude Code Stop hook — plan-review-nudge.
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

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  readLastAssistantText,
  stripCodeFences,
} from '../_shared/transcript.mts'

// Plan-announcement phrases. Each fires only if the announcement is
// NOT followed (within a window of text) by a numbered list.
const PLAN_PHRASE_RE =
  /\b(?:approach:|here'?s the plan|i will:|my plan is|step 1|steps:)\b/i

// Numbered-list shape: "1." or "1)" at line start.
const NUMBERED_LIST_RE = /^\s*1\s*[.)]\s+\S/m

// Fleet-shared resources whose edits should invite a second-opinion pass.
const FLEET_SHARED_RE =
  /\b(?:CLAUDE\.md|\.claude\/hooks\/|_shared\/|scripts\/fleet|sync-scaffolding|template\/CLAUDE\.md)\b/

// Second-opinion-invitation phrases.
const SECOND_OPINION_RE =
  /\b(?:invite a review|pair[- ]review|review (?:the|this) plan|sanity[- ]check|second[- ]opinion)\b/i

// A plan that establishes a NAME or a SCHEMA SHAPE: a new/renamed check,
// script, hook, lint rule, skill, or a manifest/schema/marker field. Once
// landed across files + cascaded, these are expensive to rename — so the final
// shape belongs IN THE PLAN, not iterated across commits (the
// make-/generate-/make- round-trip and the kind→layout+native→repo.type churn
// are the motivating examples).
const NAME_OR_SCHEMA_RE =
  /\b(?:add (?:a |the )?(?:field|marker|schema)|call (?:it|the)|marker (?:field|shape)|name (?:it|the|this)|new (?:check|field|hook|rule|schema|script|skill)|rename|renaming|schema (?:field|key|shape))\b/i

// Language signalling the shape lands across MORE THAN ONE file/commit/the
// cascade — exactly when settling-the-shape-first matters (a single
// self-contained file is cheap to rename later; a cascaded name is not).
const MULTI_SURFACE_RE =
  /\b(?:across (?:the )?fleet|both template|cascade|each repo|every (?:fleet )?repo|fleet-wide|multiple (?:commits|files)|propagat|template\/ and)/i

// Language showing the author already locked the final shape (so the nudge is
// noise) — an explicit decision, or routing the choice to the user.
const SHAPE_SETTLED_RE =
  /\b(?:AskUserQuestion|ask(?:ed|ing)? (?:the user|you)|canonical name (?:is|will be)|decided (?:on|the)|final name|locked (?:in|the)|naming (?:is )?decided|settled (?:on|the)|which name)\b/i

export const check = (payload: ToolCallPayload): GuardResult => {
  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    return undefined
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
          "name files you'll touch, name rules you'll honor",
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
      /\b(?:I will|I'?ll|I'm going to)\b/i.test(rawText)
    ) {
      hits.push(
        'plan touches fleet-shared resources (CLAUDE.md / .claude/hooks/ / ' +
          '_shared/) but does not invite a second-opinion pass — per ' +
          'CLAUDE.md "Plan review before approval", invite review before code',
      )
    }
  }

  // Check 3: a plan that establishes a NAME or SCHEMA SHAPE spread across more
  // than one file / commit / the cascade, without signalling the final shape is
  // settled. Once a name or schema field lands across the fleet, renaming it is
  // expensive — settle it in the plan (or route the choice to the user) first.
  const looksLikePlan =
    PLAN_PHRASE_RE.test(text) ||
    /\b(?:I will|I'?ll|I'm going to|plan(?:ning)? to)\b/i.test(rawText)
  if (
    looksLikePlan &&
    NAME_OR_SCHEMA_RE.test(text) &&
    MULTI_SURFACE_RE.test(text) &&
    !SHAPE_SETTLED_RE.test(text)
  ) {
    hits.push(
      'plan introduces/renames a name or schema shape that will land across ' +
        'multiple files / the cascade, but does not settle the FINAL shape ' +
        'first — per CLAUDE.md "Plan review before approval", decide the name/' +
        'field shape in the plan (or ask the user) before the commit fan-out; ' +
        'renaming a cascaded name is expensive (see "Compound lessons").',
    )
  }

  if (hits.length === 0) {
    return undefined
  }

  const lines = ['[plan-review-nudge] Plan structure check:', '']
  for (let i = 0, { length } = hits; i < length; i += 1) {
    lines.push(`  • ${hits[i]}`)
  }
  lines.push('')
  lines.push(
    '  See CLAUDE.md "Plan review before approval" — the plan itself is a deliverable.',
  )
  lines.push('')
  return notify(lines.join('\n'))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
