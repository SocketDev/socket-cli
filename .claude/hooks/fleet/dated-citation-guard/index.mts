#!/usr/bin/env node
// Claude Code PreToolUse hook — dated-citation-guard.
//
// BLOCKS (exit 2) when an Edit/Write ADDS a dated-incident citation to a
// fleet-facing rule-prose surface (CLAUDE.md, docs/agents.md/fleet,
// .claude/skills/**/SKILL.md, .claude/hooks/fleet/**/README.md).
//
// The fleet rule (CLAUDE.md "Compound lessons into rules"): when rule/hook/doc
// prose cites the case that motivated it, write it GENERICALLY, framed as an
// example ("e.g. a cascade that shipped without its reconciled lockfile") —
// NOT as a dated incident log ("<date>: pnpm <x> vs <y> at SHA <abc>"). Dates,
// version deltas, percentages, and commit SHAs age into a changelog and leak
// detail; the example shape is timeless.
//
// DRY: detection (findDatedCitations) + surface scoping (isRuleProseSurface)
// are the SAME helpers in `_shared/dated-citation.mts` that back BOTH this
// edit-time guard AND `check/rule-citations-are-generic.mts` (the commit-time
// sweep). One matcher, three call sites — they never drift.
//
// Edit-time guard + commit-time check are defense in depth: this stops the
// antipattern on the way in; the check sweeps the committed tree.
//
// Bypass: `Allow dated-citation bypass` in a recent user turn (for the rare
// case where a date is genuinely load-bearing in the prose).
//
// Self-exempt: this hook's own files + the shared matcher + the check (they
// quote dated-citation examples in their own prose to define the pattern).
//
// Exit codes:
//   2 — a dated citation was added to a rule-prose surface (blocked).
//   0 — otherwise, or on any error (fail-open).

import process from 'node:process'

import {
  findDatedCitations,
  isRuleProseSurface,
} from '../_shared/dated-citation.mts'
import {
  readFilePath,
  readPayload,
  readWriteContent,
} from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow dated-citation bypass'

// File-path fragments (normalized to `/`) that define or quote the pattern, so
// the guard doesn't fire on its own machinery.
const SELF_EXEMPT_FRAGMENTS = [
  'hooks/fleet/dated-citation-guard/',
  '_shared/dated-citation',
  'check/rule-citations-are-generic',
]

export function isSelfExempt(filePath: string | undefined): boolean {
  if (!filePath) {
    return true
  }
  const normalized = filePath.replace(/\\/g, '/')
  for (let i = 0, { length } = SELF_EXEMPT_FRAGMENTS; i < length; i += 1) {
    if (normalized.includes(SELF_EXEMPT_FRAGMENTS[i]!)) {
      return true
    }
  }
  return false
}

async function main(): Promise<void> {
  let payload
  try {
    payload = await readPayload()
  } catch {
    return
  }
  if (!payload) {
    return
  }
  const tool = payload.tool_name
  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') {
    return
  }
  const filePath = readFilePath(payload)
  if (
    isSelfExempt(filePath) ||
    !isRuleProseSurface((filePath ?? '').replace(/\\/g, '/'))
  ) {
    return
  }
  const content = readWriteContent(payload)
  if (!content) {
    return
  }
  const hits = findDatedCitations(content)
  if (!hits.length) {
    return
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return
  }
  const lines = [
    `[dated-citation-guard] Blocked: dated-incident citation(s) in rule prose — ${filePath}:`,
    '',
  ]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    lines.push(`  • ${hit.label}: ${hit.text}`)
  }
  lines.push('')
  lines.push('  CLAUDE.md "Compound lessons into rules": cite the motivating case')
  lines.push('  GENERICALLY, as a timeless example — not a dated log. Drop the')
  lines.push('  date / version delta / percentage / SHA; keep the shape of the')
  lines.push('  problem the rule prevents. Example:')
  lines.push('    ✗ "**Why:** <date> pnpm <x> vs <y> broke the cascade"')
  lines.push('    ✓ "**Why:** a stale pnpm on PATH fails the version check and')
  lines.push('       aborts the cascade install"')
  lines.push('')
  lines.push(`  Bypass: type "${BYPASS_PHRASE}" in a recent message.`)
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n')
  process.exitCode = 2
}

// Guard the entrypoint so a test importing the helpers doesn't trigger main()'s
// stdin drain (which never sees an `end` event under the test runner).
if (process.argv[1]?.endsWith('index.mts')) {
  await main()
}
