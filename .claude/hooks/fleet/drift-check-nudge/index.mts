#!/usr/bin/env node
// Claude Code Stop hook — drift-check-nudge.
//
// Flags assistant turns that edited a fleet-canonical surface in ONE
// repo without mentioning a drift check / cascade to the other fleet
// repos. The fleet's "Drift watch" rule says: when you bump a shared
// resource (tool SHA, action SHA, CLAUDE.md fleet block, hook code),
// either reconcile in the same PR or open a `chore(wheelhouse): cascade …`
// follow-up.
//
// What this hook catches:
//
//   Assistant turn mentions edits to a known drift surface — e.g.
//   `external-tools.json`, `template/CLAUDE.md`, `template/.claude/
//   hooks/`, `.github/actions/`, `lockstep.json`, `.gitmodules` —
//   AND does NOT mention "cascade" / "sync" / "fleet" / "drift" /
//   "other repos" in the same turn.
//
// Heuristic; false positives expected. Soft reminder.
//

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  readLastAssistantText,
  stripCodeFences,
} from '../_shared/transcript.mts'

// Drift-prone surfaces (fleet-canonical). Mention of any of these
// triggers the check. We avoid `\b` boundaries because some surfaces
// (e.g. `.gitmodules`) start with `.` and `\b` between two non-word
// chars never matches. Instead we look for a non-word boundary OR
// start-of-string before, and non-word OR end-of-string after.
const DRIFT_SURFACE_RE =
  /(^|\W)(\.github\/actions\/|\.gitmodules|cache-versions\.json|external-tools\.json|lockstep\.json|setup-and-install|template\/CLAUDE\.md|template\/\.claude\/hooks\/)(?=$|\W)/

// Cascade-acknowledgement phrases. Any of these in the same turn
// satisfies the check.
const CASCADE_ACK_RE =
  /\b(cascade|chore\(wheelhouse\)|downstream|drift|fleet|other repos?|re-cascade|recascade|sync-scaffolding|wheelhouse)\b/i

// We want this to fire only when an EDIT actually happened, not just
// a passing mention. The simplest proxy: look for verbs that imply
// "I just changed this" in the assistant turn.
const EDIT_VERB_RE =
  /\b(added|bumped|cascaded|changed|committed|edited|landed|modified|removed|updated)\b/i

export const check = (payload: ToolCallPayload): GuardResult => {
  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const text = stripCodeFences(rawText)

  const surfaceMatch = DRIFT_SURFACE_RE.exec(text)
  if (!surfaceMatch) {
    return undefined
  }
  if (!EDIT_VERB_RE.test(text)) {
    return undefined
  }
  if (CASCADE_ACK_RE.test(text)) {
    return undefined
  }

  const surfaceName = surfaceMatch[2]!
  // c8 ignore next - group 1 of (^|\W) always captures, never undefined at runtime
  const surfaceIdx = surfaceMatch.index + (surfaceMatch[1]?.length ?? 0)
  const start = Math.max(0, surfaceIdx - 30)
  const end = Math.min(text.length, surfaceIdx + surfaceName.length + 30)
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()

  const lines = [
    '[drift-check-nudge] Edited a fleet-canonical surface without mentioning cascade/sync:',
    '',
    `  • surface: "${surfaceName}" — …${snippet}…`,
    '',
    '  Per CLAUDE.md "Drift watch": when you edit one of these in repo A,',
    '  either reconcile the other fleet repos in the same PR or open a',
    '  `chore(wheelhouse): cascade <thing> from <repo>` follow-up.',
    '',
    '  Drift surfaces include: external-tools.json, template/CLAUDE.md,',
    '  template/.claude/hooks/, .github/actions/, lockstep.json,',
    '  cache-versions.json, .gitmodules.',
    '',
  ]
  return notify(lines.join('\n'))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
