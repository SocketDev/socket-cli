/**
 * Resolve version-pin auto-bumps from a lockstep drift report — the
 * deterministic tag math the updating-lockstep skill drives, leaving the
 * test-gate, locked-row approval, and commit prose to the model.
 *
 * The high-churn pure core is the tag resolver: given the current `pinned_tag`,
 * the list of upstream tags, and the `upgrade_policy`, it filters pre-release
 * tags, detects the tag scheme, semver-sorts, and applies track-latest vs
 * major-gate. That logic was inline jq/bash across reference.md Phases 2-3b;
 * here it is one tested function. Reuses the harness's own Report types.
 *
 * Modes:
 *   --plan --report <lockstep.json | -> [--json]
 *       INPUT: the `pnpm run lockstep --json` report on stdin or at a path.
 *       OUTPUT: { auto: PlannedRow[], advisory: AdvisoryRow[] } — each auto row
 *       carries the already-resolved targetTag (or a skipReason for locked /
 *       no-newer / major-gate-major-diff). Collapses Phases 2 + 3a + 3b.
 *
 * The --apply orchestration (checkout the tag, edit lockstep.json, call
 * gen-gitmodules-hash.mts --set, re-run the harness, assert the row is ok) is
 * documented in the skill; it shells git + the harness and is left to the skill
 * so the test-gate + commit stay model-driven.
 */

import process from 'node:process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Report, VersionPinReport } from './types.mts'

export type UpgradePolicy = 'track-latest' | 'major-gate' | 'locked'

export interface SemVer {
  major: number
  minor: number
  patch: number
}

export interface ParsedTag {
  raw: string
  prefix: string
  version: SemVer
}

export interface PlannedRow {
  id: string
  upstream: string
  pinnedTag: string | undefined
  targetTag: string | undefined
  policy: string
  skipReason?: string | undefined
}

export interface AdvisoryRow {
  kind: string
  id: string
  note: string
}

// Pre-release / nightly / preview suffixes the skill always filters — it
// targets stable releases only (reference.md "Tag-stability filter").
const PRERELEASE_RE =
  /-(?:alpha|beta|dev|nightly|preview|rc|snapshot)(?:[._-]?\d+)?$/iu

export function isStableTag(tag: string): boolean {
  return !PRERELEASE_RE.test(tag)
}

// Parse a tag into { prefix, version } across the four schemes reference.md
// enumerates: `v1.2.3`, `1.2.3`, `<prefix>-1.2.3`, `<prefix>_1_2_3`. Returns
// undefined when no semver triple is present.
export function parseTag(tag: string): ParsedTag | undefined {
  // Underscore style (curl-style `<prefix>_1_2_3` and `v_1_2_3`): digits joined
  // by underscores.
  const underscore = /^(.*?)[._-]?(\d+)_(\d+)_(\d+)$/u.exec(tag)
  if (underscore && tag.includes('_')) {
    return {
      prefix: underscore[1]!.replace(/[._-]$/u, ''),
      raw: tag,
      version: {
        major: Number(underscore[2]),
        minor: Number(underscore[3]),
        patch: Number(underscore[4]),
      },
    }
  }
  // Dotted semver, optionally v-prefixed or `<prefix>-` prefixed.
  const dotted = /^(.*?)(\d+)\.(\d+)\.(\d+)$/u.exec(tag)
  if (dotted) {
    return {
      prefix: dotted[1]!.replace(/[._-]$/u, '').replace(/^v$/u, ''),
      raw: tag,
      version: {
        major: Number(dotted[2]),
        minor: Number(dotted[3]),
        patch: Number(dotted[4]),
      },
    }
  }
  return undefined
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) {
    return a.major - b.major
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor
  }
  return a.patch - b.patch
}

// From the available tags, pick the target per policy. Only tags sharing the
// current tag's prefix + a parseable semver are candidates (so a `v`-scheme pin
// never jumps to a `<prefix>-` tag). Returns the chosen tag + an optional
// skipReason. Pure — the unit of the resolver, tested directly.
export function resolveTarget(
  pinnedTag: string | undefined,
  availableTags: readonly string[],
  policy: string,
): { targetTag: string | undefined; skipReason?: string | undefined } {
  if (policy === 'locked') {
    return { skipReason: 'upgrade_policy=locked — advisory only', targetTag: undefined }
  }
  const current = pinnedTag ? parseTag(pinnedTag) : undefined
  const stable = availableTags.filter(isStableTag)
  const parsed = stable
    .map(parseTag)
    .filter((p): p is ParsedTag => p !== undefined)
  // Constrain to the current scheme's prefix when we know it.
  const candidates =
    current === undefined
      ? parsed
      : parsed.filter(p => p.prefix === current.prefix)
  if (!candidates.length) {
    return { skipReason: 'no parseable stable tags found', targetTag: undefined }
  }
  candidates.sort((a, b) => compareSemVer(a.version, b.version))
  const latest = candidates[candidates.length - 1]!
  if (current && compareSemVer(latest.version, current.version) <= 0) {
    return { skipReason: 'already at the latest stable tag', targetTag: undefined }
  }
  if (
    policy === 'major-gate' &&
    current &&
    latest.version.major !== current.version.major
  ) {
    return {
      skipReason: `major bump (${current.version.major} → ${latest.version.major}) needs human review — policy=major-gate`,
      targetTag: undefined,
    }
  }
  return { targetTag: latest.raw }
}

function isVersionPin(r: Report): r is VersionPinReport {
  return r.kind === 'version-pin'
}

// Partition a lockstep report into the auto (version-pin, actionable policy)
// and advisory (everything else with drift/error) lists. The auto rows have no
// targetTag yet — the skill resolves each against its fetched tags via
// resolveTarget; --plan does that when given a tag map.
export function planFromReport(
  reports: readonly Report[],
  tagsByUpstream: Record<string, readonly string[]>,
): { auto: PlannedRow[]; advisory: AdvisoryRow[] } {
  const auto: PlannedRow[] = []
  const advisory: AdvisoryRow[] = []
  for (let i = 0, { length } = reports; i < length; i += 1) {
    const r = reports[i]!
    if (r.severity === 'ok') {
      continue
    }
    if (
      isVersionPin(r) &&
      (r.upgrade_policy === 'major-gate' || r.upgrade_policy === 'track-latest')
    ) {
      const tags = tagsByUpstream[r.upstream] ?? []
      const resolved = resolveTarget(r.pinned_tag, tags, r.upgrade_policy)
      if (resolved.targetTag) {
        auto.push({
          id: r.id,
          pinnedTag: r.pinned_tag,
          policy: r.upgrade_policy,
          targetTag: resolved.targetTag,
          upstream: r.upstream,
        })
      } else {
        // A version-pin that can't auto-bump (locked-major, no-newer) is an
        // advisory line, not a silent drop.
        advisory.push({
          id: r.id,
          kind: 'version-pin',
          note: resolved.skipReason ?? 'no target tag resolved',
        })
      }
      continue
    }
    advisory.push({
      id: r.id,
      kind: r.kind,
      note: `${r.severity} — needs human review`,
    })
  }
  return { advisory, auto }
}

function readReport(src: string | undefined): Report[] {
  const raw =
    src && src !== '-'
      ? readFileSync(src, 'utf8')
      : readFileSync(0, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (
    parsed &&
    typeof parsed === 'object' &&
    'reports' in parsed &&
    Array.isArray((parsed as { reports: unknown }).reports)
  ) {
    return (parsed as { reports: Report[] }).reports
  }
  throw new Error(
    'expected a lockstep report with a `reports[]` array (the `pnpm run lockstep --json` output). Pass --report <path> or pipe it on stdin.',
  )
}

export function main(argv: readonly string[]): number {
  if (!argv.includes('--plan')) {
    process.stderr.write(
      'usage: auto-bump.mts --plan --report <lockstep.json|-> [--tags <tags.json>] [--json]\n',
    )
    return 1
  }
  const reportIdx = argv.indexOf('--report')
  const reports = readReport(reportIdx !== -1 ? argv[reportIdx + 1] : undefined)
  const tagsIdx = argv.indexOf('--tags')
  const tagsByUpstream: Record<string, string[]> =
    tagsIdx !== -1 ? JSON.parse(readFileSync(argv[tagsIdx + 1]!, 'utf8')) : {}
  const plan = planFromReport(reports, tagsByUpstream)
  process.stdout.write(`${JSON.stringify(plan, undefined, 2)}\n`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
