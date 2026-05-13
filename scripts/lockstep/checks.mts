/**
 * @fileoverview Per-kind checkers for the lockstep harness.
 *
 * One `check<Kind>` function per row kind, each producing the matching
 * `<Kind>Report`. The dispatcher in `cli.mts` switches on `row.kind` and
 * routes to the right checker; each checker is independent and pure-ish
 * (reads files / submodules but mutates only the report it returns).
 *
 * `checkCrossRowConsistency` is the manifest-wide layer on top: schema
 * validation catches per-row shape, this catches referential integrity
 * (duplicate ids within an area, dangling `upstream` aliases, ports
 * pointing at sites that don't exist).
 *
 * `rootDir` is supplied by the CLI so all path resolution is relative
 * to one canonical anchor (the repo root computed in `cli.mts` from
 * `import.meta.url`).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import type {
  FeatureParityRow,
  FileForkRow,
  LangParityRow,
  Row,
  SpecConformanceRow,
  VersionPinRow,
} from './schema.mts'
import type {
  FeatureParityReport,
  FileForkReport,
  LangParityReport,
  Manifest,
  SpecConformanceReport,
  VersionPinReport,
} from './types.mts'

import {
  driftCommitsSince,
  gitIn,
  resolveUpstream,
  shaIsReachable,
  splitLines,
} from './git.mts'
import { countPatternHits, walkDirFiles } from './scan.mts'

export function checkFileFork(
  row: FileForkRow,
  manifest: Manifest,
  area: string,
  rootDir: string,
): FileForkReport {
  const messages: string[] = []
  const upstream = resolveUpstream(manifest, row.upstream, messages)
  const base: FileForkReport = {
    kind: 'file-fork',
    area,
    id: row.id,
    severity: 'ok',
    messages,
    local: row.local,
    upstream: row.upstream,
    upstream_path: row.upstream_path,
    forked_at_sha: row.forked_at_sha,
    drift: [],
  }
  if (!upstream) {
    base.severity = 'error'
    return base
  }
  const submoduleDir = path.join(rootDir, upstream.submodule)
  const localPath = path.join(rootDir, row.local)
  const upstreamFilePath = path.join(submoduleDir, row.upstream_path)

  if (!existsSync(localPath)) {
    base.severity = 'error'
    messages.push(`local file missing: ${row.local}`)
  }
  if (!existsSync(upstreamFilePath)) {
    base.severity = 'error'
    messages.push(
      `upstream file missing — submodule out of date, or upstream_path stale`,
    )
  }
  if (!shaIsReachable(submoduleDir, row.forked_at_sha)) {
    base.severity = 'error'
    messages.push(
      `forked_at_sha unreachable in submodule — submodule too shallow, or SHA typo`,
    )
  }
  if (base.severity === 'error') {
    return base
  }
  const drift = driftCommitsSince(
    submoduleDir,
    row.forked_at_sha,
    row.upstream_path,
  )
  base.drift = drift
  if (drift.length > 0) {
    base.severity = 'drift'
    messages.push(
      `${drift.length} upstream commit(s) since fork — review for bugfixes/features`,
    )
  }
  return base
}

export function checkVersionPin(
  row: VersionPinRow,
  manifest: Manifest,
  area: string,
  rootDir: string,
): VersionPinReport {
  const messages: string[] = []
  const upstream = resolveUpstream(manifest, row.upstream, messages)
  const base: VersionPinReport = {
    kind: 'version-pin',
    area,
    id: row.id,
    severity: 'ok',
    messages,
    upstream: row.upstream,
    pinned_sha: row.pinned_sha,
    pinned_tag: row.pinned_tag ?? undefined,
    upgrade_policy: row.upgrade_policy,
    head_sha: undefined,
    drift_count: 0,
  }
  if (!upstream) {
    base.severity = 'error'
    return base
  }
  const submoduleDir = path.join(rootDir, upstream.submodule)
  if (!existsSync(submoduleDir)) {
    base.severity = 'error'
    messages.push(
      `submodule not checked out at ${upstream.submodule} — run \`git submodule update --init\``,
    )
    return base
  }
  if (!shaIsReachable(submoduleDir, row.pinned_sha)) {
    base.severity = 'error'
    messages.push(`pinned_sha unreachable — submodule too shallow, or SHA typo`)
    return base
  }
  let head = ''
  try {
    head = gitIn(submoduleDir, ['rev-parse', 'HEAD']).trim()
  } catch {
    base.severity = 'error'
    messages.push(`could not read submodule HEAD`)
    return base
  }
  base.head_sha = head

  if (head !== row.pinned_sha) {
    base.severity = 'error'
    messages.push(
      `submodule HEAD (${head.slice(0, 12)}) does not match pinned_sha (${row.pinned_sha.slice(0, 12)}) — run \`git submodule update\``,
    )
    return base
  }

  // Count commits on the upstream default branch since pinned SHA.
  let driftRef = ''
  try {
    const remoteRefs = gitIn(submoduleDir, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/remotes/origin/',
    ])
    const lines = splitLines(remoteRefs).filter(s => s.trim())
    const pref = [
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
      // inclusive-language: external-api — git's historical default branch.
      'refs/remotes/origin/master',
    ]
    for (const p of pref) {
      if (lines.includes(p)) {
        driftRef = p
        break
      }
    }
  } catch {
    // no remotes available — drift can't be computed; report OK with a note.
  }
  if (!driftRef) {
    messages.push(`no origin remote ref found; cannot compute upstream drift`)
    return base
  }
  try {
    const count = gitIn(submoduleDir, [
      'rev-list',
      '--count',
      `${row.pinned_sha}..${driftRef}`,
    ]).trim()
    const n = parseInt(count, 10)
    if (!Number.isNaN(n) && n > 0) {
      base.drift_count = n
      base.severity = 'drift'
      const tagSuffix = row.pinned_tag ? ` (from ${row.pinned_tag})` : ''
      messages.push(
        `${n} upstream commit(s) since pin${tagSuffix} on ${driftRef.replace('refs/remotes/', '')}`,
      )
    }
  } catch {
    // silent — drift ref not fetched.
  }
  return base
}

export function checkFeatureParity(
  row: FeatureParityRow,
  _manifest: Manifest,
  area: string,
  rootDir: string,
): FeatureParityReport {
  const messages: string[] = []
  const base: FeatureParityReport = {
    kind: 'feature-parity',
    area,
    id: row.id,
    severity: 'ok',
    messages,
    upstream: row.upstream,
    local_area: row.local_area,
    criticality: row.criticality,
    code_score: 0,
    test_score: 0,
    fixture_score: 0,
    total_score: 0,
  }
  const localAreaPath = path.join(rootDir, row.local_area)
  if (!existsSync(localAreaPath)) {
    base.severity = 'error'
    messages.push(`local_area path missing: ${row.local_area}`)
    return base
  }

  const codePatterns = row.code_patterns ?? []
  const testPatterns = row.test_patterns ?? []
  const codeFiles = walkDirFiles(localAreaPath, /\.(m?[jt]sx?|json)$/).filter(
    f => !/[/\\](test|tests|__tests__)[/\\]|\.test\.|\.spec\./.test(f),
  )

  const codeScore =
    codePatterns.length === 0
      ? 1
      : countPatternHits(codeFiles, codePatterns) / codePatterns.length

  // Test files: by default search local_area; if test_area is set, search
  // that directory instead (sdxgen-style where tests live outside the
  // parser directory).
  const testAreaPath = path.join(rootDir, row.test_area ?? row.local_area)
  const testAreaFiles = walkDirFiles(testAreaPath, /\.(m?[jt]sx?|json)$/)
  const testFiles = row.test_area
    ? testAreaFiles
    : testAreaFiles.filter(f =>
        /[/\\](test|tests|__tests__)[/\\]|\.test\.|\.spec\./.test(f),
      )
  const testScore =
    testPatterns.length === 0
      ? 1
      : countPatternHits(testFiles, testPatterns) / testPatterns.length

  let fixtureScore = 1
  if (row.fixture_check) {
    const fixturePath = path.join(rootDir, row.fixture_check.fixture_path)
    if (!existsSync(fixturePath)) {
      fixtureScore = 0
      messages.push(`fixture not found: ${row.fixture_check.fixture_path}`)
    } else if (row.fixture_check.snapshot_path) {
      const snapPath = path.join(rootDir, row.fixture_check.snapshot_path)
      if (!existsSync(snapPath)) {
        fixtureScore = 0
        messages.push(
          `snapshot not found: ${row.fixture_check.snapshot_path} — run test suite to generate`,
        )
      }
    }
  }

  base.code_score = Math.round(codeScore * 100) / 100
  base.test_score = Math.round(testScore * 100) / 100
  base.fixture_score = Math.round(fixtureScore * 100) / 100
  const total = 0.3 * codeScore + 0.3 * testScore + 0.4 * fixtureScore
  base.total_score = Math.round(total * 100) / 100

  // Floor: higher criticality = stricter. Cap at 0.85 so 10/10 criticality
  // doesn't demand perfect pattern coverage (code is prose, patterns miss).
  const floor = Math.min(0.85, row.criticality / 10)
  if (total < floor) {
    base.severity = 'drift'
    messages.push(
      `parity score ${base.total_score} below floor ${Math.round(floor * 100) / 100} (criticality ${row.criticality})`,
    )
  }
  return base
}

export function checkSpecConformance(
  row: SpecConformanceRow,
  manifest: Manifest,
  area: string,
  rootDir: string,
): SpecConformanceReport {
  const messages: string[] = []
  const upstream = resolveUpstream(manifest, row.upstream, messages)
  const base: SpecConformanceReport = {
    kind: 'spec-conformance',
    area,
    id: row.id,
    severity: 'ok',
    messages,
    upstream: row.upstream,
    local_impl: row.local_impl,
    spec_version: row.spec_version,
    spec_path: row.spec_path ?? undefined,
  }
  if (!upstream) {
    base.severity = 'error'
    return base
  }
  const localImplPath = path.join(rootDir, row.local_impl)
  if (!existsSync(localImplPath)) {
    base.severity = 'error'
    messages.push(`local_impl missing: ${row.local_impl}`)
    return base
  }
  if (row.spec_path) {
    const specPath = path.join(rootDir, upstream.submodule, row.spec_path)
    if (!existsSync(specPath)) {
      base.severity = 'error'
      messages.push(`spec_path missing in upstream submodule: ${row.spec_path}`)
      return base
    }
  }
  return base
}

export function checkLangParity(
  row: LangParityRow,
  manifest: Manifest,
  area: string,
): LangParityReport {
  const messages: string[] = []
  const base: LangParityReport = {
    kind: 'lang-parity',
    area,
    id: row.id,
    severity: 'ok',
    messages,
    category: row.category,
    ports: row.ports,
  }

  const declaredSites = Object.keys(manifest.sites ?? {})
  if (declaredSites.length === 0) {
    base.severity = 'error'
    messages.push(`manifest has lang-parity rows but no top-level 'sites' map`)
    return base
  }

  for (const site of declaredSites) {
    if (!(site in row.ports)) {
      base.severity = 'error'
      messages.push(`port '${site}' missing (declared in sites)`)
    }
  }
  for (const port of Object.keys(row.ports)) {
    if (!declaredSites.includes(port)) {
      base.severity = 'error'
      messages.push(`port '${port}' not in sites map`)
    }
    const state = row.ports[port]!
    if (state.status === 'opt-out' && (!state.reason || !state.reason.trim())) {
      base.severity = 'error'
      messages.push(`port '${port}' is opt-out without a reason`)
    }
  }

  if (row.category === 'rejected') {
    for (const port of Object.keys(row.ports)) {
      const state = row.ports[port]!
      if (state.status !== 'opt-out') {
        base.severity = 'drift'
        messages.push(
          `REJECTED anti-pattern reintroduced: port '${port}' is '${state.status}' (must be 'opt-out' for category=rejected)`,
        )
      }
    }
  }

  return base
}

// ---------------------------------------------------------------------------
// Cross-row consistency checks (beyond zod's per-row validation).
// ---------------------------------------------------------------------------

/**
 * Cross-row checks that zod validation can't express: unique ids, upstream
 * refs resolve to the `upstreams` map, port keys resolve to the `sites`
 * map. Zod's `LockstepManifestSchema.parse()` (called from `loadManifestTree`)
 * already covers per-row shape, enum values, id pattern, and required
 * fields — this is the referential-integrity layer on top.
 */
export function checkCrossRowConsistency(
  rowsWithArea: Array<{ row: Row; area: string }>,
  merged: Manifest,
): string[] {
  const errors: string[] = []
  // Ids are unique per area, not globally. Same concept can legitimately
  // appear in multiple areas (e.g. ultrathink has `transport-stdio` in both
  // lsp and mcp). Scope the seen-set per area.
  const seenIdsPerArea = new Map<string, Set<string>>()
  const upstreamAliases = new Set(Object.keys(merged.upstreams ?? {}))
  const siteKeys = new Set(Object.keys(merged.sites ?? {}))

  for (const { row, area } of rowsWithArea) {
    const loc = `[${area}/${row.id}]`

    let areaIds = seenIdsPerArea.get(area)
    if (!areaIds) {
      areaIds = new Set()
      seenIdsPerArea.set(area, areaIds)
    }
    if (areaIds.has(row.id)) {
      errors.push(`${loc} duplicate id within area`)
    }
    areaIds.add(row.id)

    if (
      row.kind === 'file-fork' ||
      row.kind === 'version-pin' ||
      row.kind === 'feature-parity' ||
      row.kind === 'spec-conformance'
    ) {
      if (!upstreamAliases.has(row.upstream)) {
        errors.push(
          `${loc} upstream '${row.upstream}' not in upstreams map (known: ${[...upstreamAliases].join(', ') || '(none)'})`,
        )
      }
    }

    if (row.kind === 'lang-parity') {
      for (const port of Object.keys(row.ports)) {
        if (!siteKeys.has(port)) {
          errors.push(
            `${loc} port '${port}' not in sites map (known: ${[...siteKeys].join(', ') || '(none)'})`,
          )
        }
      }
    }
  }

  return errors
}
