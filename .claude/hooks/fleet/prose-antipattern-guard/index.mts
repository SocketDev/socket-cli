#!/usr/bin/env node
// Claude Code PreToolUse hook — prose-antipattern-guard.
//
// BLOCKS Write/Edit to human-facing prose surfaces (CHANGELOG.md,
// docs/**/*.md, README.md) when the new content carries an AI-writing
// antipattern: throat-clearing openers, "not X, it's Y" contrasts, em-dash
// chains, vague hedging adverbs. The fleet rule (CLAUDE.md "Prose authoring",
// .claude/skills/fleet/prose/SKILL.md): run human-facing prose through the
// prose skill before it lands. This is the hard gate — it supersedes the old
// prose-antipattern-reminder Stop hook (a reminder fires after the write and
// is ignorable; a PreToolUse block stops the bad prose from landing at all).
//
// Bypass: `Allow prose-antipattern bypass` typed verbatim in a recent user
// turn. Disable entirely via SOCKET_PROSE_ANTIPATTERN_GUARD_DISABLED.

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { findProseAntipatterns } from './patterns.mts'
import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow prose-antipattern bypass'

// Prose surfaces the guard covers, matched against the normalized (forward-
// slash) path. CHANGELOG.md and README.md at any depth; any markdown under a
// `docs/` directory.
const CHANGELOG_RE = /(?:^|\/)CHANGELOG\.md$/
const README_RE = /(?:^|\/)README\.md$/
const DOCS_MD_RE = /(?:^|\/)docs\/.+\.md$/

function isProseSurface(normalizedPath: string): boolean {
  return (
    CHANGELOG_RE.test(normalizedPath) ||
    README_RE.test(normalizedPath) ||
    DOCS_MD_RE.test(normalizedPath)
  )
}

await withEditGuard((filePath, content, payload) => {
  if (process.env['SOCKET_PROSE_ANTIPATTERN_GUARD_DISABLED']) {
    return
  }
  if (content === undefined) {
    return
  }
  const normalized = normalizePath(filePath)
  if (!isProseSurface(normalized)) {
    return
  }
  const hits = findProseAntipatterns(content)
  if (!hits.length) {
    return
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return
  }
  const logger = getDefaultLogger()
  const rel = path.basename(filePath)
  logger.error(`🚨 prose-antipattern-guard: blocked write to ${rel}.`)
  logger.error('')
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    logger.error(`  ✗ ${hit.label}: ${hit.why}`)
  }
  logger.error('')
  logger.error(
    'Per CLAUDE.md "Prose authoring": run human-facing prose through the `prose`',
  )
  logger.error(
    'skill (.claude/skills/fleet/prose/SKILL.md) before it lands. Rewrite the',
  )
  logger.error('flagged spans, then retry the edit.')
  logger.error('')
  logger.error(`Bypass (rare): the user types "${BYPASS_PHRASE}" verbatim.`)
  process.exitCode = 2
})
