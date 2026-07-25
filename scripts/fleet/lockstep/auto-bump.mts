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
 * --plan --report <lockstep.json | -> [--json]
 * INPUT: the `pnpm run lockstep --json` report on stdin or at a path.
 * OUTPUT: { auto: PlannedRow[], advisory: AdvisoryRow[] } — each auto row
 * carries the already-resolved targetTag (or a skipReason for locked /
 * no-newer / major-gate-major-diff). Collapses Phases 2 + 3a + 3b.
 *
 * --apply --id <row-id> --target-tag <tag> [--manifest <lockstep.json>]
 * Lands ONE resolved bump: checkout the target tag inside the row's
 * submodule, rewrite that version-pin row's `pinned_tag` + `pinned_sha`
 * in `lockstep.json`, regenerate the `.gitmodules` `# <name>-<version>
 * sha256:…` annotation via gen/gitmodules-hash.mts --set, and commit
 * `chore(deps): bump <upstream> to <tag>`. Collapses reference.md Phase 3
 * (the bash the skill used to inline). The skill still owns the per-row
 * test gate + the locked-row human approval (it only calls --apply for an
 * already-approved, validated row); the deterministic git + edit + commit
 * mechanics live here so they are tested, not re-typed per run.
 */

import process from 'node:process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import {
  applyBump,
  classifyTarget,
  gitmodulesLabelForTag,
  isSuspectBackward,
  writePinnedFields,
} from './auto-bump-apply.mts'
import {
  listManifestFiles,
  loadManifestTree,
  readManifest,
  resolveManifestRoot,
} from './manifest.mts'

import type { ApplyConfig, ApplyResult } from './auto-bump-apply.mts'
import type { Report, VersionPinReport } from './types.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

export {
  applyBump,
  classifyTarget,
  gitmodulesLabelForTag,
  isSuspectBackward,
  writePinnedFields,
}
export type { ApplyConfig, ApplyResult }

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
  /**
   * Default-branch HEAD SHA to bump to when no stable tag is actionable
   * (tagless upstream, or the pin is already at/past the latest stable tag)
   * and the policy is `track-latest`. Exactly one of targetTag / targetSha is
   * set on an auto row.
   */
  targetSha?: string | undefined
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
  // Underscore style (curl-style `<prefix>_1_2_3` and `v_1_2_3`): digits
  // joined by underscores. Two-component forms (postgres `REL_17_9`) parse
  // with patch = 0 — before this, an unparseable pin dropped the prefix
  // constraint and the resolver could propose a CROSS-SERIES DOWNGRADE
  // (REL_17_9 → REL9_6_24, the only 3-component tags in that repo).
  const underscore = /^(.*?)[._-]?(\d+)_(\d+)(?:_(\d+))?$/u.exec(tag)
  if (underscore && tag.includes('_')) {
    return {
      prefix: underscore[1]!.replace(/[._-]$/u, ''),
      raw: tag,
      version: {
        major: Number(underscore[2]),
        minor: Number(underscore[3]),
        patch: Number(underscore[4] ?? 0),
      },
    }
  }
  // Dotted semver, optionally v-prefixed or `<prefix>-` prefixed. Two-
  // component forms (`liburing-2.15`) parse with patch = 0.
  const dotted = /^(.*?)(\d+)\.(\d+)(?:\.(\d+))?$/u.exec(tag)
  if (dotted) {
    return {
      prefix: dotted[1]!.replace(/[._-]$/u, '').replace(/^v$/u, ''),
      raw: tag,
      version: {
        major: Number(dotted[2]),
        minor: Number(dotted[3]),
        patch: Number(dotted[4] ?? 0),
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
    return {
      skipReason: 'upgrade_policy=locked — advisory only',
      targetTag: undefined,
    }
  }
  const current = pinnedTag ? parseTag(pinnedTag) : undefined
  // A pinned tag that EXISTS but doesn't parse must never fall through to
  // unconstrained matching — without the prefix constraint the resolver can
  // select a different tag series entirely (a downgrade vector). Surface it
  // for a human instead.
  if (pinnedTag && current === undefined) {
    return {
      skipReason: `pinned tag ${pinnedTag} does not parse — human review`,
      targetTag: undefined,
    }
  }
  const stable = availableTags.filter(isStableTag)
  const parsed = stable
    .map(parseTag)
    .filter((p): p is ParsedTag => p !== undefined)
  // Constrain to the current scheme's prefix when we know it. When the row is
  // sha-pinned (no pinned_tag) there is NO scheme constraint — comparing raw
  // semver across a MULTI-EPOCH tag set proposed real downgrades (Go's 2011
  // `release.r60.3`, pre-2.x sbt, superseded 4-component nuget tags). A
  // sha-pin may adopt a tag only when the repo's stable tags all share ONE
  // prefix; otherwise the schemes are ambiguous and a human picks.
  if (current === undefined && parsed.length > 0) {
    const prefixes = new Set(parsed.map(p => p.prefix))
    if (prefixes.size > 1) {
      return {
        skipReason: `sha-pinned row with ${prefixes.size} tag schemes (${[...prefixes].slice(0, 4).join(', ')}…) — ambiguous, human review`,
        targetTag: undefined,
      }
    }
  }
  const candidates =
    current === undefined
      ? parsed
      : parsed.filter(p => p.prefix === current.prefix)
  if (!candidates.length) {
    return {
      skipReason: 'no parseable stable tags found',
      targetTag: undefined,
    }
  }
  candidates.sort((a, b) => compareSemVer(a.version, b.version))
  const latest = candidates[candidates.length - 1]!
  if (current && compareSemVer(latest.version, current.version) <= 0) {
    return {
      skipReason: 'already at the latest stable tag',
      targetTag: undefined,
    }
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
  originHeadByUpstream: Record<string, string> = {},
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
        continue
      }
      // HEAD leg: a track-latest row with drift but no actionable stable tag
      // (tagless upstream, or the pin already sits at/past the latest stable
      // tag) follows the default branch — bump to the report's head_sha.
      // Forwardness is guaranteed by the harness: it only reports drift when
      // origin/HEAD is ahead of the pin. major-gate rows never HEAD-hop; they
      // stay advisory so a human sees them.
      // The report's head_sha is the submodule CHECKOUT head (== the pin by
      // construction); the remote tip comes from the caller-gathered
      // origin/HEAD map (runPlan resolves it next to the tag map).
      const originHead = originHeadByUpstream[r.upstream]
      const headEligible =
        r.upgrade_policy === 'track-latest' &&
        resolved.skipReason === 'no parseable stable tags found' &&
        typeof originHead === 'string' &&
        originHead.length > 0 &&
        originHead !== r.pinned_sha
      if (headEligible) {
        auto.push({
          id: r.id,
          pinnedTag: r.pinned_tag,
          policy: r.upgrade_policy,
          targetSha: originHead,
          targetTag: undefined,
          upstream: r.upstream,
        })
        continue
      }
      // A version-pin that can't auto-bump (locked-major, no-newer) is an
      // advisory line, not a silent drop.
      advisory.push({
        id: r.id,
        kind: 'version-pin',
        note: resolved.skipReason ?? 'no target tag resolved',
      })
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
    src && src !== '-' ? readFileSync(src, 'utf8') : readFileSync(0, 'utf8')
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

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag)
  return idx !== -1 ? argv[idx + 1] : undefined
}

// Walk the manifest tree (root + includes[]) and return the FILE that
// physically holds the version-pin row — the file --apply must rewrite.
// Returns undefined when no file in the tree carries the row.
export function resolveOwningManifest(
  rootManifestPath: string,
  id: string,
): string | undefined {
  for (const file of listManifestFiles(rootManifestPath)) {
    const manifest = readManifest(file)
    for (const row of manifest.rows) {
      if (row.kind === 'version-pin' && row.id === id) {
        return file
      }
    }
  }
  return undefined
}

function runApply(argv: readonly string[]): number {
  const id = flagValue(argv, '--id')
  const targetTag = flagValue(argv, '--target-tag')
  const targetSha = flagValue(argv, '--target-sha')
  if (!id || (targetTag === undefined) === (targetSha === undefined)) {
    process.stderr.write(
      'usage: auto-bump.mts --apply --id <row-id> (--target-tag <tag> | --target-sha <sha>) [--manifest <lockstep.json>]\n',
    )
    return 1
  }
  const rootManifestPath =
    flagValue(argv, '--manifest') ?? resolveManifestRoot(REPO_ROOT)
  // The row may live in an includes[] sub-manifest — rewrite the owning file,
  // not the tree root (a root-only read reports skipped-no-row for every
  // included row).
  const manifestPath = resolveOwningManifest(rootManifestPath, id)
  const result = applyBump({
    id,
    manifestPath: manifestPath ?? rootManifestPath,
    repoRoot: REPO_ROOT,
    targetSha,
    targetTag,
  })
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
  return result.state === 'bumped' ? 0 : 1
}

// Gather each actionable upstream's LOCAL tags (`git tag -l` inside the
// submodule — deterministic; the caller's fetch supplies freshness) so --plan
// works without a hand-built --tags file. An explicit --tags map still wins.
export function gatherLocalTags(
  rootManifestPath: string,
  reports: readonly Report[],
  repoRoot: string,
): Record<string, string[]> {
  const { merged } = loadManifestTree(rootManifestPath)
  const out: Record<string, string[]> = {
    __proto__: null,
  } as unknown as Record<string, string[]>
  for (const r of reports) {
    if (!isVersionPin(r) || out[r.upstream]) {
      continue
    }
    const upstream = merged.upstreams?.[r.upstream]
    if (!upstream?.submodule) {
      continue
    }
    const probe = spawnSync(
      'git',
      ['-C', path.join(repoRoot, upstream.submodule), 'tag', '-l'],
      { stdio: ['ignore', 'pipe', 'ignore'], stdioString: true },
    )
    out[r.upstream] =
      probe.status === 0 ? String(probe.stdout).split('\n').filter(Boolean) : []
  }
  return out
}

// Gather each actionable upstream's fetched origin/HEAD tip so --plan can
// resolve the HEAD leg (the report's head_sha is the checkout head, which
// equals the pin by construction). Deterministic: reads the local
// remote-tracking ref the caller's fetch refreshed; no network.
export function gatherOriginHeads(
  rootManifestPath: string,
  reports: readonly Report[],
  repoRoot: string,
): Record<string, string> {
  const { merged } = loadManifestTree(rootManifestPath)
  const out: Record<string, string> = { __proto__: null } as unknown as Record<
    string,
    string
  >
  for (const r of reports) {
    if (!isVersionPin(r) || out[r.upstream]) {
      continue
    }
    const upstream = merged.upstreams?.[r.upstream]
    if (!upstream?.submodule) {
      continue
    }
    const probe = spawnSync(
      'git',
      [
        '-C',
        path.join(repoRoot, upstream.submodule),
        'rev-parse',
        'origin/HEAD',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], stdioString: true },
    )
    if (probe.status === 0) {
      out[r.upstream] = String(probe.stdout).trim()
    }
  }
  return out
}

function runPlan(argv: readonly string[]): number {
  const reportIdx = argv.indexOf('--report')
  const reports = readReport(reportIdx !== -1 ? argv[reportIdx + 1] : undefined)
  const tagsIdx = argv.indexOf('--tags')
  const rootManifestPath =
    flagValue(argv, '--manifest') ?? resolveManifestRoot(REPO_ROOT)
  const tagsByUpstream: Record<string, string[]> =
    tagsIdx !== -1
      ? JSON.parse(readFileSync(argv[tagsIdx + 1]!, 'utf8'))
      : gatherLocalTags(rootManifestPath, reports, REPO_ROOT)
  const originHeadByUpstream = gatherOriginHeads(
    rootManifestPath,
    reports,
    REPO_ROOT,
  )
  const plan = planFromReport(reports, tagsByUpstream, originHeadByUpstream)
  process.stdout.write(`${JSON.stringify(plan, undefined, 2)}\n`)
  return 0
}

export function main(argv: readonly string[]): number {
  if (argv.includes('--apply')) {
    return runApply(argv)
  }
  if (argv.includes('--plan')) {
    return runPlan(argv)
  }
  process.stderr.write(
    'usage: auto-bump.mts --plan --report <lockstep.json|-> [--tags <tags.json>] [--manifest <lockstep.json>] [--json]\n' +
      '       auto-bump.mts --apply --id <row-id> (--target-tag <tag> | --target-sha <sha>) [--manifest <lockstep.json>]\n',
  )
  return 1
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
