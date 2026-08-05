#!/usr/bin/env node
/*
 * @file Commit-time gate for CLAUDE.md's repo-specific (🏗️) section. The fleet
 *   block above it is already a flat bullet index; this holds the per-repo half
 *   to the same shape so the whole file stays scannable and stays under the
 *   40 KB cap.
 *
 *   Three findings:
 *
 *   1. `prose_paragraph` — a content line that is not a `- ` bullet. One short
 *      orienting sentence may open the section or a `###` subsection; a second
 *      consecutive prose line is a paragraph, and paragraphs bury the rule
 *      inside sentences instead of listing it.
 *   2. `bullet_too_long` — a bullet past BULLET_MAX_CHARS. The index states the
 *      rule in one line; the explanation belongs in
 *      `docs/agents.md/repo/<topic>.md`.
 *   3. `no_detail_link` — a long bullet with no `docs/agents.md/repo/` link, so
 *      there is nowhere for a reader to go for the detail it elided.
 *
 *   Repo docs are per-repo and never cascaded, so this check reads only the
 *   host repo's own tree.
 *
 *   Exit codes:
 *
 *   - 0 — the repo section is a bullet index (or the section is absent/empty)
 *   - 1 — at least one finding
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { repoRegionBounds } from '../../../.claude/hooks/fleet/_shared/fleet-markers.mts'
import type { RepoRegionBounds } from '../../../.claude/hooks/fleet/_shared/fleet-markers.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

// The repo-specific section opens with this heading. Everything below it is
// per-repo content the cascade never overwrites. Only a fallback for a
// not-yet-migrated member — a freshly seeded CLAUDE.md (template/presets/
// CLAUDE.md) wraps the section in `<repo>` markers instead, which
// findRepoSectionBounds prefers when present.
export const REPO_SECTION_HEADING = '## 🏗️'

/**
 * Locate the repo-specific section: the shared `<repo>` marker pair when
 * present (a seeded member — repoRegionBounds), else the `## 🏗️` heading (a
 * not-yet-migrated member) through the end of the file. Returns undefined
 * when neither is found — nothing to audit.
 */
export function findRepoSectionBounds(
  lines: readonly string[],
): RepoRegionBounds | undefined {
  const marker = repoRegionBounds(lines)
  if (marker !== undefined) {
    return marker
  }
  const headingStart = lines.findIndex(l => l.startsWith(REPO_SECTION_HEADING))
  if (headingStart === -1) {
    return undefined
  }
  return { end: lines.length, start: headingStart }
}

// A bullet longer than this is carrying its explanation inline. The fleet block
// measured a 286-char median before it was flattened, which is what pushed
// CLAUDE.md toward the size cap and made the trimmer start cutting clause tails.
export const BULLET_MAX_CHARS = 200

export interface RepoSectionFinding {
  readonly kind: 'bullet_too_long' | 'no_detail_link' | 'prose_paragraph'
  readonly line: number
  readonly message: string
}

// True for a line that carries no content: blank, an HTML comment, a heading,
// a table row, or a list continuation indented under its bullet.
function isStructuralLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed === '' ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('<!--') ||
    trimmed.startsWith('|') ||
    trimmed.startsWith('>') ||
    /^\s+/.test(line)
  )
}

/**
 * Audit the repo-specific section of a CLAUDE.md body. Returns every finding,
 * empty when the section is a clean bullet index or absent entirely.
 */
export function auditRepoSection(body: string): RepoSectionFinding[] {
  const lines = body.split('\n')
  const bounds = findRepoSectionBounds(lines)
  if (bounds === undefined) {
    return []
  }
  const { end, start } = bounds
  const findings: RepoSectionFinding[] = []
  let inFence = false
  // Resets at every heading: one orienting sentence per section is allowed.
  let proseAllowance = 1
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i]!
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }
    if (line.startsWith('#')) {
      proseAllowance = 1
      continue
    }
    if (line.startsWith('- ')) {
      if (line.length > BULLET_MAX_CHARS) {
        findings.push({
          kind: 'bullet_too_long',
          line: i + 1,
          message: `bullet is ${line.length} chars (max ${BULLET_MAX_CHARS}) — move the explanation into docs/agents.md/repo/<topic>.md`,
        })
        // A repo bullet may cite a fleet topic when the rule it states is a
        // fleet rule the repo happens to surface; either tier is a real home
        // for the detail, so accept both.
        if (!line.includes('docs/agents.md/')) {
          findings.push({
            kind: 'no_detail_link',
            line: i + 1,
            message:
              'long bullet has no docs/agents.md/ link — the elided detail needs a home',
          })
        }
      }
      continue
    }
    if (isStructuralLine(line)) {
      continue
    }
    if (proseAllowance > 0) {
      proseAllowance -= 1
      continue
    }
    findings.push({
      kind: 'prose_paragraph',
      line: i + 1,
      message:
        'prose line past the one allowed orienting sentence — write the rule as a `- ` bullet',
    })
  }
  return findings
}

export function main(): void {
  const claudeMdPath = path.join(REPO_ROOT, 'CLAUDE.md')
  if (!existsSync(claudeMdPath)) {
    process.stdout.write(
      '[check-claude-md-repo-section] no CLAUDE.md in this repo; nothing to check.\n',
    )
    return
  }
  const findings = auditRepoSection(readFileSync(claudeMdPath, 'utf8'))
  if (!findings.length) {
    process.stdout.write(
      '[check-claude-md-repo-section] the repo-specific section is a bullet index.\n',
    )
    return
  }
  process.stderr.write(
    `[check-claude-md-repo-section] ${findings.length} finding(s) in the 🏗️ section of CLAUDE.md:\n\n`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    process.stderr.write(`  CLAUDE.md:${f.line} ${f.kind}: ${f.message}\n`)
  }
  process.stderr.write(
    '\nFix: one rule per `- ` bullet, stating the rule in one line, linking\n' +
      '  [`topic`](docs/agents.md/repo/<topic>.md) for the detail. A paragraph\n' +
      '  buries the rule inside sentences; a bullet list is greppable and lets a\n' +
      '  reader scan the whole contract in seconds.\n\n',
  )
  process.exit(1)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks the CLAUDE.md repo-specific section stays a flat bullet index',
  help: 'Usage: node scripts/fleet/check/claude-md-repo-section-is-a-bullet-index.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
