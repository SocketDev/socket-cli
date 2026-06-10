#!/usr/bin/env node
// Claude Code PreToolUse hook — dated-citation-reminder.
//
// Nudges (never blocks) when an Edit/Write ADDS a dated-incident citation to a
// fleet-facing rule-prose surface (CLAUDE.md, docs/agents.md/fleet,
// .claude/skills/**/SKILL.md, .claude/hooks/fleet/**/README.md).
//
// The fleet rule (CLAUDE.md "Compound lessons into rules"): when rule/hook/doc
// prose cites the case that motivated it, write it GENERICALLY, framed as an
// example ("e.g. a cascade that shipped without its reconciled lockfile") —
// NOT as a dated incident log ("2026-06-07: pnpm 11.0.0 vs 11.5.1 at SHA
// abc1234"). Dates, version deltas, percentages, and commit SHAs age into a
// changelog and leak detail; the example shape is timeless. This is the
// edit-time nudge; `check/rule-citations-are-generic.mts` is the commit-time
// gate that sweeps the same shape across the committed tree.
//
// A reminder, not a guard: a date is occasionally load-bearing in prose, so
// this surfaces the antipattern on the way in but lets the write through. The
// commit-time check is the hard gate.
//
// Detection (findDatedCitations) + surface scoping (isRuleProseSurface) are
// SHARED with the check via `_shared/dated-citation.mts`, so the two never
// drift. Only RATIONALE lines (carrying `**Why:**` / "incident" / "regression"
// / "red-lined") that ALSO carry a specificity token fire — a bare date in a
// SHA-pin comment, soak annotation, or CHANGELOG entry is left alone.
//
// Self-exempt: this hook's own files + the shared matcher + the check (they
// quote dated-citation examples in their own prose to define the pattern).
//
// Exit codes: always 0 (nudge only). Fails open on malformed payload.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import process from 'node:process'

import {
  findDatedCitations,
  isRuleProseSurface,
} from '../_shared/dated-citation.mts'
import { readFilePath, readPayload, readWriteContent } from '../_shared/payload.mts'

const logger = getDefaultLogger()

// File-path fragments (normalized to `/`) that define or quote the pattern, so
// the nudge doesn't fire on its own machinery.
const SELF_EXEMPT_FRAGMENTS = [
  'hooks/fleet/dated-citation-reminder/',
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
  if (isSelfExempt(filePath) || !isRuleProseSurface((filePath ?? '').replace(/\\/g, '/'))) {
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
  const lines = [
    `[dated-citation-reminder] dated-incident citation(s) in rule prose — ${filePath}:`,
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
  lines.push('    ✗ "**Why:** 2026-06-07 pnpm 11.0.0 vs 11.5.1 broke the cascade"')
  lines.push('    ✓ "**Why:** a stale pnpm on PATH fails the version check and')
  lines.push('       aborts the cascade install"')
  lines.push('')
  lines.push('  (Nudge only — the write proceeds. check/rule-citations-are-generic')
  lines.push('  is the commit-time gate.)')
  logger.error(lines.join('\n'))
}

// Guard the entrypoint so a test importing the helpers doesn't trigger main()'s
// stdin drain (which never sees an `end` event under the test runner).
if (process.argv[1]?.endsWith('index.mts')) {
  await main()
}
