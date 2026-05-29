#!/usr/bin/env node
/**
 * @file Whole-file commit-time gate that mirrors the edit-time
 *   `.claude/hooks/fleet/soak-exclude-date-annotation-guard/`. Scans the repo's
 *   `pnpm-workspace.yaml` `minimumReleaseAgeExclude:` block and reports any
 *   per-package exact-pin entry missing the canonical `# published: YYYY-MM-DD
 *   | removable: YYYY-MM-DD` annotation. Why the second surface (hook +
 *   script): defense in depth. The hook blocks Edit/Write in-session; this
 *   script catches anything that lands via a non-Claude path (manual `git
 *   checkout`, external editor, etc.). Reports stale entries too — any line
 *   whose `removable:` date is in the past is a cleanup candidate. Reporting is
 *   informational only (exit 0 on stale entries; exit 1 only on missing
 *   annotation). Exit codes:
 *
 *   - 0 — clean (no missing annotations; stale entries logged as warnings)
 *   - 1 — at least one missing annotation
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SECTION_HEADER = /^minimumReleaseAgeExclude:\s*$/
const ANY_TOP_LEVEL_KEY = /^[A-Za-z_][\w-]*:\s*(\S.*)?$/
const ENTRY_RE =
  /^\s*-\s*['"]?((?:@[^@/'"\s]+\/)?[^@'"\s]+)@([^'"\s]+)['"]?\s*$/
const GLOB_ENTRY_RE = /^\s*-\s*['"]?[^'"\s]*\*[^'"\s]*['"]?\s*$/
const BARE_NAME_ENTRY_RE = /^\s*-\s*['"]?[^@'"\s]+['"]?\s*$/
const ANNOTATION_RE =
  /^\s*#\s+published:\s+(\d{4}-\d{2}-\d{2})\s+\|\s+removable:\s+(\d{4}-\d{2}-\d{2})\s*$/
const ALLOW_MARKER = '# socket-hook: allow soak-exclude-no-date-annotation'

interface Finding {
  kind: 'missing' | 'stale'
  line: number
  name: string
  version: string
  removable?: string | undefined
}

function scan(text: string, todayISO: string): Finding[] {
  const lines = text.split('\n')
  const findings: Finding[] = []
  let inBlock = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (SECTION_HEADER.test(line)) {
      inBlock = true
      continue
    }
    if (!inBlock) {
      continue
    }
    if (ANY_TOP_LEVEL_KEY.test(line) && !line.startsWith(' ')) {
      inBlock = false
      continue
    }
    const m = ENTRY_RE.exec(line)
    if (!m) {
      continue
    }
    if (line.includes(ALLOW_MARKER)) {
      continue
    }
    if (GLOB_ENTRY_RE.test(line) || BARE_NAME_ENTRY_RE.test(line)) {
      continue
    }
    const name = m[1] ?? '<unknown>'
    const version = m[2] ?? '<unknown>'
    const prev = i > 0 ? (lines[i - 1] ?? '') : ''
    const annotationMatch = ANNOTATION_RE.exec(prev)
    if (!annotationMatch) {
      findings.push({ kind: 'missing', line: i + 1, name, version })
      continue
    }
    const removable = annotationMatch[2]!
    if (removable < todayISO) {
      findings.push({
        kind: 'stale',
        line: i + 1,
        name,
        version,
        removable,
      })
    }
  }
  return findings
}

function main(): void {
  // Anchor on this script's location and walk up to the repo root
  // (the dir containing pnpm-workspace.yaml). process.cwd() is unstable
  // because the script may be invoked from any working directory.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(here, '..')
  const yamlPath = path.join(repoRoot, 'pnpm-workspace.yaml')
  let content: string
  try {
    content = readFileSync(yamlPath, 'utf8')
  } catch {
    // No pnpm-workspace.yaml — not a workspace repo, nothing to check.
    process.exit(0)
  }
  const todayISO = new Date().toISOString().slice(0, 10)
  const findings = scan(content, todayISO)
  const missing = findings.filter(f => f.kind === 'missing')
  const stale = findings.filter(f => f.kind === 'stale')

  if (stale.length > 0) {
    process.stderr.write(
      `[check-soak-exclude-dates] ${stale.length} stale soak-bypass ` +
        `entr${stale.length === 1 ? 'y' : 'ies'} ` +
        `(removable: date in the past) — candidates for cleanup:\n`,
    )
    for (let i = 0, { length } = stale; i < length; i += 1) {
      const f = stale[i]!
      process.stderr.write(
        `  line ${f.line}: ${f.name}@${f.version} (removable ${f.removable})\n`,
      )
    }
    process.stderr.write(
      `\nRun \`pnpm install\` after removing — the soak has cleared naturally.\n\n`,
    )
  }

  if (missing.length > 0) {
    process.stderr.write(
      `[check-soak-exclude-dates] ${missing.length} missing soak-bypass ` +
        `annotation${missing.length === 1 ? '' : 's'}:\n`,
    )
    for (let i = 0, { length } = missing; i < length; i += 1) {
      const f = missing[i]!
      process.stderr.write(`  line ${f.line}: ${f.name}@${f.version}\n`)
    }
    process.stderr.write(
      `\nEach per-package soak-bypass needs the canonical annotation directly above the bullet:\n` +
        `  # published: <YYYY-MM-DD> | removable: <YYYY-MM-DD>\n` +
        `  - 'pkg@1.2.3'\n` +
        `\nReference: docs/claude.md/fleet/tooling.md "Soak time".\n`,
    )
    process.exit(1)
  }

  process.exit(0)
}

main()
