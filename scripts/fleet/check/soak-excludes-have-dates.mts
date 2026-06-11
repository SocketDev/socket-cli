#!/usr/bin/env node
/**
 * @file Whole-file commit-time gate that mirrors the edit-time
 *   `.claude/hooks/fleet/soak-exclude-date-guard/`. Scans the repo's
 *   `pnpm-workspace.yaml` `minimumReleaseAgeExclude:` block and reports any
 *   per-package exact-pin entry missing the canonical `# published: YYYY-MM-DD
 *   | removable: YYYY-MM-DD` annotation. Why the second surface (hook +
 *   script): defense in depth. The hook blocks Edit/Write in-session; this
 *   script catches anything that lands via a non-Claude path (manual `git
 *   checkout`, external editor, etc.). Reports stale entries too — any line
 *   whose `removable:` date is in the past is a cleanup candidate. Reporting is
 *   informational by default (exit 0 on stale entries; exit 1 only on missing
 *   annotation). `--fix` flips stale-reporting into PROMOTE mode: it removes
 *   each soaked entry (the bullet + its annotation line) from
 *   `pnpm-workspace.yaml` and writes the file. The caller runs `pnpm install`
 *   after to reconcile the lockfile. This is what the daily `updating-daily`
 *   job runs. Exit codes:
 *
 *   - 0 — clean (no missing annotations; stale entries logged or, with --fix,
 *     promoted)
 *   - 1 — at least one missing annotation
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { isSocketSourcedPackage } from '../constants/socket-scopes.mts'
import { PNPM_WORKSPACE_YAML } from '../paths.mts'

const SECTION_HEADER = /^minimumReleaseAgeExclude:\s*$/
const ANY_TOP_LEVEL_KEY = /^[A-Za-z_][\w-]*:\s*(\S.*)?$/
const ENTRY_RE =
  /^\s*-\s*['"]?((?:@[^@/'"\s]+\/)?[^@'"\s]+)@([^'"\s]+)['"]?\s*$/
const GLOB_ENTRY_RE = /^\s*-\s*['"]?[^'"\s]*\*[^'"\s]*['"]?\s*$/
const BARE_NAME_ENTRY_RE = /^\s*-\s*['"]?[^@'"\s]+['"]?\s*$/
// In-repo workspace-member PATH globs (`packages/*`, `.claude/hooks/**`,
// `.config/oxlint-plugin/**`, `template/**`) aren't npm packages — they never
// soak, so they're always exempt. Everything ELSE that's exempt must be
// Socket-OWNED (decided by the canonical SOCKET_PACKAGE_PATTERNS via
// isSocketSourcedPackage), not hardcoded here. A third-party scope glob (e.g.
// `@yuku-parser/*`) is NOT exempt — it must pin concrete `@scope/pkg@version`
// members, since a blanket scope-bypass would admit any future upstream publish.
const WORKSPACE_PATH_GLOB_RE =
  /^(?:template\/)?(?:\.claude\/|\.config\/|packages\/|template\/)/
const ANNOTATION_RE =
  /^\s*#\s+published:\s+(\d{4}-\d{2}-\d{2})\s+\|\s+removable:\s+(\d{4}-\d{2}-\d{2})\s*$/
const ALLOW_MARKER = '# socket-lint: allow soak-exclude-no-date-annotation'

// An exclude entry's bare-name / glob-scope is exempt from version-pinning when
// it's an in-repo workspace path or a Socket-owned package. `sfw` (a bare
// Socket binary tool) is covered because SOCKET_PACKAGE_PATTERNS lists it; a
// glob like `@socketsecurity/*` is covered because isSocketSourcedPackage
// matches a representative member name. The canonical list lives in
// constants/socket-scopes.mts — never re-hardcode the Socket scopes here.
export function isSoakPinExempt(entryName: string): boolean {
  if (WORKSPACE_PATH_GLOB_RE.test(entryName)) {
    return true
  }
  // Reduce a glob to a representative package name for the Socket matcher:
  // `@scope/*` → `@scope/x`, `prefix-*` → `prefix-x`, bare name → itself.
  const probe = entryName.endsWith('/*')
    ? `${entryName.slice(0, -1)}x`
    : entryName.endsWith('*')
      ? `${entryName.slice(0, -1)}x`
      : entryName
  return isSocketSourcedPackage(probe)
}

export interface Finding {
  kind: 'missing' | 'stale' | 'unpinned'
  line: number
  name: string
  version: string
  removable?: string | undefined
}

export function scan(text: string, todayISO: string): Finding[] {
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
    if (line.includes(ALLOW_MARKER)) {
      continue
    }
    // A glob entry is exempt ONLY when it's a Socket-owned scope (or an in-repo
    // workspace path) — see isSoakPinExempt. A third-party scope glob
    // (`@yuku-parser/*`) is a blanket-bypass of someone else's future releases —
    // flag it like a bare name so it gets pinned to concrete members.
    if (GLOB_ENTRY_RE.test(line)) {
      const globName =
        /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)?.[1] ?? '<unknown>'
      if (isSoakPinExempt(globName)) {
        continue
      }
      findings.push({
        kind: 'unpinned',
        line: i + 1,
        name: globName,
        version: '<none>',
      })
      continue
    }
    // A concrete (non-glob) entry MUST be version-pinned: `name@version`. A bare
    // name pins no version, so the soak-bypass leaks to every future release of
    // the package — exactly the gap a dated `# published:/removable:` annotation
    // is supposed to scope. Flag it.
    if (BARE_NAME_ENTRY_RE.test(line)) {
      const bareName =
        /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)?.[1] ?? '<unknown>'
      // A Socket-owned bare name (e.g. `sfw`, a versionless GitHub-release
      // binary) is exempt — decided by the canonical SOCKET_PACKAGE_PATTERNS,
      // not a hardcoded set. A versioned third-party npm package still pins.
      if (isSoakPinExempt(bareName)) {
        continue
      }
      findings.push({
        kind: 'unpinned',
        line: i + 1,
        name: bareName,
        version: '<none>',
      })
      continue
    }
    const m = ENTRY_RE.exec(line)
    if (!m) {
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

/**
 * Promote (remove) stale soak-exclude entries: for each stale finding, drop the
 * `- 'pkg@ver'` bullet and, when present directly above it, its `# published: …
 * | removable: …` annotation line. Everything else (other entries, their
 * comments, the rest of the file) is preserved verbatim. Processes findings
 * bottom-up so earlier line numbers stay valid as later lines are spliced out.
 *
 * @param content - The pnpm-workspace.yaml text.
 * @param stale - Stale findings from `scan()` (each carries a 1-based `line`).
 *
 * @returns The updated content (unchanged when `stale` is empty).
 */
export function removeStaleEntries(content: string, stale: Finding[]): string {
  if (stale.length === 0) {
    return content
  }
  const lines = content.split('\n')
  // 1-based line numbers, descending, so splices don't shift pending indices.
  const byLineDesc = [...stale].sort((a, b) => b.line - a.line)
  for (let i = 0, { length } = byLineDesc; i < length; i += 1) {
    const idx = byLineDesc[i]!.line - 1
    // Remove a preceding annotation line if it's the canonical comment.
    const hasAnnotation = idx > 0 && ANNOTATION_RE.test(lines[idx - 1] ?? '')
    const start = hasAnnotation ? idx - 1 : idx
    lines.splice(start, idx - start + 1)
  }
  return lines.join('\n')
}

function main(): void {
  let content: string
  try {
    content = readFileSync(PNPM_WORKSPACE_YAML, 'utf8')
  } catch {
    // No pnpm-workspace.yaml — not a workspace repo, nothing to check.
    process.exit(0)
  }
  const fix = process.argv.includes('--fix')
  const todayISO = new Date().toISOString().slice(0, 10)
  const findings = scan(content, todayISO)
  const missing = findings.filter(f => f.kind === 'missing')
  const stale = findings.filter(f => f.kind === 'stale')
  const unpinned = findings.filter(f => f.kind === 'unpinned')

  if (stale.length > 0 && fix) {
    // Promote: the soak cleared, so the bypass is no longer needed.
    const promoted = removeStaleEntries(content, stale)
    writeFileSync(PNPM_WORKSPACE_YAML, promoted)
    process.stdout.write(
      `[check-soak-excludes-have-dates] promoted ${stale.length} soaked ` +
        `entr${stale.length === 1 ? 'y' : 'ies'} out of minimumReleaseAgeExclude:\n`,
    )
    for (let i = 0, { length } = stale; i < length; i += 1) {
      const f = stale[i]!
      process.stdout.write(`  - ${f.name}@${f.version}\n`)
    }
    process.stdout.write(`\nRun \`pnpm install\` to reconcile the lockfile.\n`)
    // Promoting is the whole job in --fix mode; missing-annotation reporting
    // still runs below so a fix run also surfaces malformed entries.
  } else if (stale.length > 0) {
    process.stderr.write(
      `[check-soak-excludes-have-dates] ${stale.length} stale soak-bypass ` +
        `entr${stale.length === 1 ? 'y' : 'ies'} ` +
        `(removable: date in the past) — candidates for cleanup ` +
        `(run with --fix to promote):\n`,
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
      `[check-soak-excludes-have-dates] ${missing.length} missing soak-bypass ` +
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
        `\nReference: docs/agents.md/fleet/tooling.md "Soak time".\n`,
    )
    process.exit(1)
  }

  if (unpinned.length > 0) {
    process.stderr.write(
      `[check-soak-excludes-have-dates] ${unpinned.length} unpinned third-party ` +
        `soak-exclude entr${unpinned.length === 1 ? 'y' : 'ies'} (bare name, no ` +
        `\`@version\`):\n`,
    )
    for (let i = 0, { length } = unpinned; i < length; i += 1) {
      const f = unpinned[i]!
      process.stderr.write(`  line ${f.line}: ${f.name}\n`)
    }
    process.stderr.write(
      `\nA concrete soak-exclude must pin the exact version, so the bypass can't ` +
        `leak to a future release:\n` +
        `  - 'pkg@1.2.3'   not   - 'pkg'\n` +
        `First-party scope globs (\`@scope/*\`, \`socket-*\`) are exempt.\n` +
        `Reference: docs/agents.md/fleet/tooling.md "Soak time".\n`,
    )
    process.exit(1)
  }

  process.exit(0)
}

// Run only when invoked directly (CLI / CI), not when imported by the unit
// tests for `scan` / `removeStaleEntries` — `main()` calls `process.exit`,
// which would tear down the test runner mid-suite.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
