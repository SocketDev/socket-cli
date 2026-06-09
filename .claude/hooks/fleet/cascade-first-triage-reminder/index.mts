#!/usr/bin/env node
// Claude Code Stop hook — cascade-first-triage-reminder.
//
// Nudges when the assistant reacted to a "not found" / "missing" /
// "unregistered" error for a fleet-CANONICAL artifact by debugging or
// hand-patching the MEMBER repo's copy, instead of checking the wheelhouse
// template first and re-cascading. Member repos hold byte-copies of
// wheelhouse-canonical content (`.config/fleet/**`, `scripts/fleet/**`,
// `.claude/hooks/fleet/**`, the `socket/*` oxlint plugin, `_shared/` libs).
// When one of those goes missing in a member, it is almost always an
// incomplete cascade — the cascade SKIPS a fleet dir whose template source
// is git-dirty — not a real bug to fix in the member.
//
// What this catches: an assistant turn that BOTH
//   (a) shows a not-found-shaped error naming a canonical artifact, AND
//   (b) describes editing / patching a member-repo copy of fleet content,
// WITHOUT acknowledging the cascade-first path (check wheelhouse, re-cascade).
//
// Heuristic; false positives expected. Soft reminder, never blocks.
// Per CLAUDE.md "Never fork fleet-canonical files locally" (cascade-first
// triage).

import process from 'node:process'

import {
  readLastAssistantText,
  readStdin,
  stripCodeFences,
} from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

// A "not found"-shaped error for a canonical artifact: a rule, hook, lib,
// or check that the tooling reports as absent/unregistered.
const NOT_FOUND_RE =
  /\b(not found|no such (?:rule|file|module|hook)|cannot find|missing|unregistered|does not exist|isn't registered|is not registered)\b/i

// Mentions of a fleet-canonical artifact KIND (the things that live in the
// wheelhouse and cascade out). A bare "file not found" without one of these
// is too generic to flag. `plugin ['"]?socket` catches the oxlint loader's
// own `Rule '…' not found in plugin 'socket'` message shape.
const CANONICAL_ARTIFACT_RE =
  /(socket\/[a-z0-9-]+|oxlint[- ]plugin|plugin ['"]?socket|\.config\/fleet\/|scripts\/fleet\/|\.claude\/hooks\/fleet\/|_shared\/|fleet[- ]canonical|check-[a-z-]+\.mts)/i

// Evidence the assistant DEBUGGED / PATCHED the member copy rather than
// re-cascading: edit verbs aimed at a member-repo path or "the copy".
const MEMBER_PATCH_RE =
  /\b(edited|patched|hand-?patch|fixed (?:the )?(?:member|downstream|live|cascaded) (?:copy|file)|git apply|added .* to (?:socket-(?:lib|cli|bin|btm|registry|sdk-js|mcp|packageurl-js|addon)))\b/i

// The cascade-first acknowledgement that satisfies the check.
const CASCADE_ACK_RE =
  /\b(re-?cascade|cascade-first|check(?:ed)? the wheelhouse|wheelhouse (?:has|template)|sync-scaffolding|incomplete cascade|cascade issue|cascade incompleteness)\b/i

async function main(): Promise<void> {
  const payloadRaw = await readStdin()
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

  if (!NOT_FOUND_RE.test(text)) {
    process.exit(0)
  }
  if (!CANONICAL_ARTIFACT_RE.test(text)) {
    process.exit(0)
  }
  if (!MEMBER_PATCH_RE.test(text)) {
    process.exit(0)
  }
  if (CASCADE_ACK_RE.test(text)) {
    process.exit(0)
  }

  const lines = [
    '[cascade-first-triage-reminder] A canonical artifact looked "not found" in a member repo and you patched the member copy.',
    '',
    '  Member repos hold byte-copies of wheelhouse-canonical content',
    '  (.config/fleet/**, scripts/fleet/**, .claude/hooks/fleet/**, the',
    '  socket/* oxlint plugin, _shared/ libs). A missing/unregistered one is',
    '  almost always an INCOMPLETE CASCADE, not a bug to fix in the member.',
    '',
    '  Cascade-first triage:',
    '    1. Check the wheelhouse template/ for the artifact.',
    '    2. If present → re-cascade the member:',
    '         node scripts/repo/sync-scaffolding/cli.mts --target <repo> --fix',
    '    3. If the cascade SKIPS a fleet dir, its template source is git-dirty',
    '       (WIP / a parallel session) — commit/reconcile the template, re-cascade.',
    '    4. Only if genuinely absent from the wheelhouse is it a real authoring task.',
    '',
    '  Per CLAUDE.md "Never fork fleet-canonical files locally".',
    '',
  ]
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
