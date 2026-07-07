#!/usr/bin/env node
/*
 * @file Whole-file commit-time gate that mirrors the edit-time
 *   `.claude/hooks/fleet/soak-exclude-date-guard/`. Scans the repo's
 *   `pnpm-workspace.yaml` `minimumReleaseAgeExclude:` AND `trustPolicyExclude:`
 *   blocks and reports any per-package exact-pin entry missing the canonical `#
 *   published: YYYY-MM-DD | removable: YYYY-MM-DD` annotation. Why the second
 *   surface (hook + script): defense in depth. The hook blocks Edit/Write
 *   in-session; this script catches anything that lands via a non-Claude path
 *   (manual `git checkout`, external editor, etc.). Reports stale entries too —
 *   any line whose `removable:` date is in the past is a cleanup candidate.
 *
 *   The two blocks differ in cleanup safety, so stale entries are handled
 *   asymmetrically:
 *   - `minimumReleaseAgeExclude` (soak bypass): a cleared soak is ALWAYS safe
 *     to drop — the 7-day gate would admit the version anyway. Reporting is
 *     informational (exit 0); `--fix` PROMOTE-mode removes each soaked entry
 *     (the bullet + its annotation line) and writes the file. This is what the
 *     daily `updating-daily` job runs.
 *   - `trustPolicyExclude` (supply-chain waiver): removing a waiver re-arms the
 *     `no-downgrade` trust gate, which can re-break `pnpm install` if the
 *     waived version still resolves. So a stale trust waiver is a DEFECT
 *     requiring a human re-audit (exit 1) — never auto-promoted, even under
 *     `--fix`.
 *
 *   The caller runs `pnpm install` after a promote to reconcile the lockfile.
 *   Exit codes:
 *
 *   - 0 — clean (no missing annotations; stale soak entries logged or, with
 *     --fix, promoted)
 *   - 1 — at least one missing annotation, unpinned entry, or stale trust
 *     waiver
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { isSocketSourcedPackage } from '../constants/socket-scopes.mts'
import { PNPM_WORKSPACE_YAML } from '../paths.mts'

// The two soak/waiver list blocks this gate scans. Both carry `name@version`
// exact-pin bullets with `# published: … | removable: …` annotations; they
// differ only in cleanup safety (see the @file note + handleStale in main).
const SOAK_HEADER = /^minimumReleaseAgeExclude:\s*$/
const TRUST_HEADER = /^trustPolicyExclude:\s*$/
const ANY_TOP_LEVEL_KEY = /^[A-Za-z_][\w-]*:\s*(\S.*)?$/
// Match a version-pinned exclude bullet: optional leading quote, then an
// optional scoped-package prefix (`@scope/`), the bare name, a literal `@`,
// and the version token — both captured. Trailing quote and whitespace allowed.
const ENTRY_RE =
  /^\s*-\s*['"]?((?:@[^@/'"\s]+\/)?[^@'"\s]+)@([^'"\s]+)['"]?\s*$/
const GLOB_ENTRY_RE = /^\s*-\s*['"]?[^'"\s]*\*[^'"\s]*['"]?\s*$/
const BARE_NAME_ENTRY_RE = /^\s*-\s*['"]?[^@'"\s]+['"]?\s*$/
// In-repo workspace-member PATH globs (`packages/*`, `.claude/hooks/**`,
// `.config/fleet/oxlint-plugin/**`, `template/**`) aren't npm packages — they never
// soak, so they're always exempt. Everything ELSE that's exempt must be
// Socket-OWNED (decided by the canonical SOCKET_PACKAGE_PATTERNS via
// isSocketSourcedPackage), not hardcoded here. A third-party scope glob (e.g.
// `@yuku-parser/*`) is NOT exempt — it must pin concrete `@scope/pkg@version`
// members, since a blanket scope-bypass would admit any future upstream publish.
const WORKSPACE_PATH_GLOB_RE =
  /^(?:template\/)?(?:\.claude\/|\.config\/|packages\/|template\/)/
// Match the canonical soak annotation comment: `# published: YYYY-MM-DD |
// removable: YYYY-MM-DD`, capturing both ISO dates.
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

export type SoakBlock = 'minimumReleaseAgeExclude' | 'trustPolicyExclude'

export interface Finding {
  // Which list block the entry lives in — drives the asymmetric stale handling
  // (soak entries auto-promote; trust waivers require human re-audit).
  block: SoakBlock
  kind: 'missing' | 'stale' | 'unpinned'
  line: number
  name: string
  version: string
  removable?: string | undefined
}

export function scan(text: string, todayISO: string): Finding[] {
  const lines = text.split('\n')
  const findings: Finding[] = []
  let block: SoakBlock | undefined
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (SOAK_HEADER.test(line)) {
      block = 'minimumReleaseAgeExclude'
      continue
    }
    if (TRUST_HEADER.test(line)) {
      block = 'trustPolicyExclude'
      continue
    }
    if (!block) {
      continue
    }
    if (ANY_TOP_LEVEL_KEY.test(line) && !line.startsWith(' ')) {
      block = undefined
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
        block,
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
        block,
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
      findings.push({ block, kind: 'missing', line: i + 1, name, version })
      continue
    }
    const removable = annotationMatch[2]!
    if (removable < todayISO) {
      findings.push({
        block,
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
  const byLineDesc = [...stale].toSorted((a, b) => b.line - a.line)
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
  // Missing-annotation + unpinned enforcement is soak-only: blocking on a trust
  // entry would risk fleet-wide red, since the synth renderer emits trust
  // bullets without annotations and there is no cascade reverse-prune to heal a
  // member that already carries one. A malformed soak entry, by contrast, is
  // always the author's own edit to fix.
  const missing = findings.filter(
    f => f.kind === 'missing' && f.block === 'minimumReleaseAgeExclude',
  )
  const unpinned = findings.filter(
    f => f.kind === 'unpinned' && f.block === 'minimumReleaseAgeExclude',
  )
  const soakStale = findings.filter(
    f => f.kind === 'stale' && f.block === 'minimumReleaseAgeExclude',
  )
  const trustStale = findings.filter(
    f => f.kind === 'stale' && f.block === 'trustPolicyExclude',
  )

  if (soakStale.length > 0 && fix) {
    // Promote: the soak cleared, so the bypass is no longer needed.
    const promoted = removeStaleEntries(content, soakStale)
    writeFileSync(PNPM_WORKSPACE_YAML, promoted)
    process.stdout.write(
      `[check-soak-excludes-have-dates] promoted ${soakStale.length} soaked ` +
        `entr${soakStale.length === 1 ? 'y' : 'ies'} out of minimumReleaseAgeExclude:\n`,
    )
    for (let i = 0, { length } = soakStale; i < length; i += 1) {
      const f = soakStale[i]!
      process.stdout.write(`  - ${f.name}@${f.version}\n`)
    }
    process.stdout.write(`\nRun \`pnpm install\` to reconcile the lockfile.\n`)
    // Promoting is the whole job in --fix mode; the reporting below still runs
    // so a fix run also surfaces malformed entries + stale trust waivers.
  } else if (soakStale.length > 0) {
    process.stderr.write(
      `[check-soak-excludes-have-dates] ${soakStale.length} stale soak-bypass ` +
        `entr${soakStale.length === 1 ? 'y' : 'ies'} ` +
        `(removable: date in the past) — candidates for cleanup ` +
        `(run with --fix to promote):\n`,
    )
    for (let i = 0, { length } = soakStale; i < length; i += 1) {
      const f = soakStale[i]!
      process.stderr.write(
        `  line ${f.line}: ${f.name}@${f.version} (removable ${f.removable})\n`,
      )
    }
    process.stderr.write(
      `\nRun \`pnpm install\` after removing — the soak has cleared naturally.\n\n`,
    )
  }

  // A stale trust-policy waiver is reported but NEVER auto-pruned: removing it
  // re-arms the no-downgrade supply-chain gate, which can re-break `pnpm
  // install` if the waived version still resolves. It needs a human re-audit,
  // not a mechanical drop — so this is informational (exit 0), the same posture
  // soak stale-reporting takes outside --fix.
  if (trustStale.length > 0) {
    process.stderr.write(
      `[check-soak-excludes-have-dates] ${trustStale.length} stale trust-policy ` +
        `waiver${trustStale.length === 1 ? '' : 's'} ` +
        `(removable: date in the past) in trustPolicyExclude:\n`,
    )
    for (let i = 0, { length } = trustStale; i < length; i += 1) {
      const f = trustStale[i]!
      process.stderr.write(
        `  line ${f.line}: ${f.name}@${f.version} (removable ${f.removable})\n`,
      )
    }
    process.stderr.write(
      `\nA trust waiver bypasses the no-downgrade gate; a stale one needs a human ` +
        `re-audit, not an auto-prune. Re-confirm the version is safe (or has rolled ` +
        `forward), then drop it from EXPECTED_TRUST_POLICY_EXCLUDE in the manifest ` +
        `and the live YAML.\nReference: docs/agents.md/fleet/tooling.md.\n\n`,
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
