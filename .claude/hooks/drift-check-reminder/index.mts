#!/usr/bin/env node
// Claude Code Stop hook — drift-check-reminder.
//
// Flags assistant turns that edited a fleet-canonical surface in ONE
// repo without mentioning a drift check / cascade to the other fleet
// repos. The fleet's "Drift watch" rule says: when you bump a shared
// resource (tool SHA, action SHA, CLAUDE.md fleet block, hook code),
// either reconcile in the same PR or open a `chore(sync): cascade …`
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
// Disable via SOCKET_DRIFT_CHECK_REMINDER_DISABLED.

import process from 'node:process'

import {
  readLastAssistantText,
  readStdin,
  stripCodeFences,
} from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

// Drift-prone surfaces (fleet-canonical). Mention of any of these
// triggers the check. We avoid `\b` boundaries because some surfaces
// (e.g. `.gitmodules`) start with `.` and `\b` between two non-word
// chars never matches. Instead we look for a non-word boundary OR
// start-of-string before, and non-word OR end-of-string after.
const DRIFT_SURFACE_RE =
  /(^|\W)(external-tools\.json|template\/CLAUDE\.md|template\/\.claude\/hooks\/|\.github\/actions\/|lockstep\.json|\.gitmodules|setup-and-install|cache-versions\.json)(?=$|\W)/

// Cascade-acknowledgement phrases. Any of these in the same turn
// satisfies the check.
const CASCADE_ACK_RE =
  /\b(cascade|sync(-scaffolding)?|drift|fleet|other repos?|downstream|chore\(sync\)|re-cascade|recascade)\b/i

// We want this to fire only when an EDIT actually happened, not just
// a passing mention. The simplest proxy: look for verbs that imply
// "I just changed this" in the assistant turn.
const EDIT_VERB_RE =
  /\b(updated|edited|modified|bumped|added|removed|cascaded|landed|committed|changed)\b/i

async function main(): Promise<void> {
  const payloadRaw = await readStdin()
  if (process.env['SOCKET_DRIFT_CHECK_REMINDER_DISABLED']) {
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

  const surfaceMatch = DRIFT_SURFACE_RE.exec(text)
  if (!surfaceMatch) {
    process.exit(0)
  }
  if (!EDIT_VERB_RE.test(text)) {
    process.exit(0)
  }
  if (CASCADE_ACK_RE.test(text)) {
    process.exit(0)
  }

  const surfaceName = surfaceMatch[2]!
  const surfaceIdx = surfaceMatch.index + (surfaceMatch[1]?.length ?? 0)
  const start = Math.max(0, surfaceIdx - 30)
  const end = Math.min(text.length, surfaceIdx + surfaceName.length + 30)
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()

  const lines = [
    '[drift-check-reminder] Edited a fleet-canonical surface without mentioning cascade/sync:',
    '',
    `  • surface: "${surfaceName}" — …${snippet}…`,
    '',
    '  Per CLAUDE.md "Drift watch": when you edit one of these in repo A,',
    '  either reconcile the other fleet repos in the same PR or open a',
    '  `chore(sync): cascade <thing> from <repo>` follow-up.',
    '',
    '  Drift surfaces include: external-tools.json, template/CLAUDE.md,',
    '  template/.claude/hooks/, .github/actions/, lockstep.json,',
    '  cache-versions.json, .gitmodules.',
    '',
  ]
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
