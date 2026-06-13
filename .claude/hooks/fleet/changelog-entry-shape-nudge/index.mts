#!/usr/bin/env node
// Claude Code PreToolUse(Edit|Write) hook — changelog-entry-shape-nudge.
//
// NUDGES (non-blocking, exit 0) when a CHANGELOG.md edit adds an entry bullet
// that carries no link into docs/agents.md/{fleet,repo}/<topic>.md. The fleet
// rule (CLAUDE.md "Prose authoring"): a CHANGELOG entry is a one-line bullet
// stating the user-visible change, with the detail linked to an agents.md doc —
// `- <change> ([`topic`](docs/agents.md/fleet/<topic>.md))`. The doc is the
// source of truth; the changelog stays a scannable index, same diet pattern as
// the CLAUDE.md reference card.
//
// A NUDGE, not a guard: short bullets without a doc yet are common mid-work, so
// this reminds rather than blocks. The shape is a preference; prose quality is
// the separate hard gate (prose-antipattern-guard) and impl-detail another.
//
// Only the ADDED content matters: a Write's full content, or an Edit's
// new_string. We flag a `- ` entry bullet that has no `docs/agents.md/` link
// and isn't a sub-bullet / heading / blank.
//
// No bypass phrase (it never blocks). Exit 0 always.

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { withEditGuard } from '../_shared/payload.mts'

const CHANGELOG_RE = /(?:^|\/)CHANGELOG\.md$/
const AGENTS_DOC_LINK = 'docs/agents.md/'

// A top-level changelog entry bullet: `- ` or `* ` at column 0 (not indented
// sub-bullets, which elaborate a parent entry and need no own link).
export function entryBulletsMissingDocLink(content: string): string[] {
  const out: string[] = []
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!/^[-*] +\S/.test(line)) {
      continue
    }
    if (line.includes(AGENTS_DOC_LINK)) {
      continue
    }
    out.push(line.trim())
  }
  return out
}

await withEditGuard((filePath, content, _payload) => {
  if (content === undefined) {
    return
  }
  if (!CHANGELOG_RE.test(normalizePath(filePath))) {
    return
  }
  const missing = entryBulletsMissingDocLink(content)
  if (!missing.length) {
    return
  }
  const logger = getDefaultLogger()
  const rel = path.basename(filePath)
  logger.warn(
    `[changelog-entry-shape-nudge] ${missing.length} CHANGELOG entr${missing.length === 1 ? 'y' : 'ies'} in ${rel} link no agents.md doc:`,
  )
  const shown = Math.min(missing.length, 5)
  for (let i = 0; i < shown; i += 1) {
    logger.warn(`  • ${missing[i]}`)
  }
  logger.warn('')
  logger.warn(
    'A CHANGELOG entry is a one-line bullet linking the detail to an agents.md',
  )
  logger.warn(
    'doc — `- <change> ([`topic`](docs/agents.md/fleet/<topic>.md))`. Put the',
  )
  logger.warn(
    'rationale + mechanism in the doc; keep the changelog a scannable index.',
  )
  // Non-blocking: this is a NUDGE. Exit 0 so the edit proceeds.
})
