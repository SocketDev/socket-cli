#!/usr/bin/env node
/*
 * @file Whole-file commit-time gate that audits CLAUDE.md `###` section bodies
 *   for informativeness. Every section between two `### ` headings must contain
 *   at least one of:
 *
 *   1. A hook citation: `(enforced by \`.claude/hooks/...`)` or `enforced by
 *      `.claude/hooks/...``
 *   2. A docs link: `[anything](docs/agents.md/...)` or `[anything](docs/...)`
 *      pointing at a same-repo detail file
 *   3. An explicit opt-out: `(advisory, no enforcement)` anywhere in the section
 *      body Sections that are pure prose without one of these three signals are
 *      reported as findings. Per the Salesforce agentic-engineering article,
 *      CLAUDE.md variance is a direct quality driver; the size guard already
 *      keeps each section terse, this guard keeps each section anchored to
 *      either an enforcer or a detail page. Exit codes:
 *
 *   - 0 — every section anchors to an enforcer / docs link / advisory opt-out
 *   - 1 — at least one section is pure prose without any of the three
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  isFleetMarkerBeginLine,
  isFleetMarkerEndLine,
} from '../../../.claude/hooks/fleet/_shared/fleet-markers.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

// A top-level `- ` bullet is a rule. The thin CLAUDE.md is a flat list — one
// bullet per rule, each carrying its own enforcer citation / detail-doc link.
// `## ` headings are chrome; indented sub-bullets are detail under a rule, not
// rules themselves — only column-0 `- ` lines are audited.
const RULE_BULLET_RE = /^- (.+)$/

// Hook citation in any inline form. Sections may use either:
//   (enforced by `.claude/hooks/fleet/<name>/`)
//   `.claude/hooks/fleet/<name>/`        (bare backtick, no `enforced by`)
//   Enforced at three levels: `.claude/hooks/fleet/...`
// Match the path itself wherever it appears in the section body —
// the presence of a hook-path backtick is itself the anchor signal.
const HOOK_CITATION_RE = /[`'"]\.claude\/hooks\/[^\s'"`)]+/i

// Docs link to a same-repo detail file. Match any `[text](URL)` where
// URL contains `docs/` — covers `docs/agents.md/...`, `docs/references/...`,
// package-scoped `packages/<pkg>/docs/...`, and skill-relative `.claude/
// skills/.../docs/...`. The `[text](path)` form is the only one that
// matters; bare URLs in prose don't count.
const DOCS_LINK_RE = /\]\([^)]*\bdocs\/[^)]+\)/i

// Skill reference inside a backticked path — covers sections that point
// at a fleet skill instead of a docs/ tree. Same intent: anchor the
// section to a discoverable artifact beyond the inline prose.
const SKILL_REFERENCE_RE = /\.claude\/skills\/[^\s`)]+\/SKILL\.md/i

// Explicit opt-out markers (any equivalent form):
//   - Inline prose: `(advisory, no enforcement)`
//   - HTML comment: `<!--advisory-->` (or `<!-- advisory -->`)
// Cheaper byte-wise for terse sections that genuinely have no
// detail page. Use only when a section is a soft norm — no hook,
// no detail file. The audit passes such sections.
const ADVISORY_OPTOUT_RE =
  /\(advisory,\s*no\s*enforcement\)|<!--\s*advisory\s*-->/i

// Sections under the in-document `## 🏗️ ...` block (the project-
// specific block AFTER the fleet block in CLAUDE.md). The fleet
// block runs from `## 📚 Wheelhouse Standards` to a `<!-- END
// FLEET-CANONICAL -->` marker. Audit only the fleet block — the
// repo-specific block is per-repo and may legitimately be more
// prose-heavy.

export interface Finding {
  line: number
  heading: string
}

export interface AuditResult {
  findings: Finding[]
  totalSections: number
  enforcedSections: number
}

// Parse CLAUDE.md and emit one Finding per top-level `- ` rule bullet in the
// fleet block whose line carries none of: hook citation, docs link, skill
// reference, advisory opt-out. Bullets OUTSIDE the fleet block are ignored.
// (totalSections/enforcedSections keep their names but now count rule bullets.)
export function audit(text: string): AuditResult {
  const lines = text.split('\n')
  const findings: Finding[] = []
  let inFleetBlock = false
  let totalSections = 0
  let enforcedSections = 0
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (isFleetMarkerBeginLine(line)) {
      inFleetBlock = true
      continue
    }
    if (isFleetMarkerEndLine(line)) {
      inFleetBlock = false
      continue
    }
    if (!inFleetBlock) {
      continue
    }
    const m = RULE_BULLET_RE.exec(line)
    if (!m) {
      continue
    }
    totalSections += 1
    if (
      HOOK_CITATION_RE.test(line) ||
      DOCS_LINK_RE.test(line) ||
      SKILL_REFERENCE_RE.test(line) ||
      ADVISORY_OPTOUT_RE.test(line)
    ) {
      enforcedSections += 1
    } else {
      findings.push({ line: i + 1, heading: m[1]!.slice(0, 60) })
    }
  }
  return { findings, totalSections, enforcedSections }
}

function main(): void {
  const mdPath = path.join(REPO_ROOT, 'CLAUDE.md')
  if (!existsSync(mdPath)) {
    // No CLAUDE.md — nothing to audit, exit clean.
    process.exit(0)
  }
  const content = readFileSync(mdPath, 'utf8')
  const result = audit(content)

  const showScore = process.argv.includes('--score')
  if (showScore) {
    const pct =
      result.totalSections === 0
        ? 100
        : Math.round((result.enforcedSections * 100) / result.totalSections)
    process.stdout.write(
      `[check-claude-md-informativeness] informativeness score: ` +
        `${result.enforcedSections}/${result.totalSections} sections ` +
        `(${pct}%) anchor to a hook citation, docs link, or advisory opt-out.\n`,
    )
  }

  if (result.findings.length > 0) {
    process.stderr.write(
      `[check-claude-md-informativeness] ${result.findings.length} section${
        result.findings.length === 1 ? '' : 's'
      } in the fleet block lack any of:\n\n` +
        '  1. A hook citation: `` `.claude/hooks/...` `` reference\n' +
        '  2. A docs link: `[text](docs/...)` to a detail file\n' +
        '  3. A skill reference: `.claude/skills/.../SKILL.md`\n' +
        '  4. An explicit opt-out: `(advisory, no enforcement)`\n\n' +
        'Findings (line: heading):\n\n',
    )
    for (let i = 0, { length } = result.findings; i < length; i += 1) {
      const f = result.findings[i]!
      process.stderr.write(`  line ${f.line}: - ${f.heading}\n`)
    }
    process.stderr.write(
      `\nFix: add an enforcer or link to a detail page. CLAUDE.md is ` +
        `load-bearing context; sections without an enforcement anchor ` +
        `tend to rot.\n\n`,
    )
    process.exit(1)
  }

  if (!showScore) {
    process.stdout.write(
      `[check-claude-md-informativeness] all ${result.totalSections} fleet ` +
        `sections anchor to an enforcer, docs link, or advisory opt-out.\n`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
