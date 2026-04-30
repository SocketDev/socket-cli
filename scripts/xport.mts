/**
 * @fileoverview xport lock-step harness (canonical; mirrored in
 * socket-repo-template/template/scripts/xport.mts).
 *
 * Reads `xport.json` (+ any `includes[]` sub-manifests) and validates each
 * row against its upstream or sibling ports. Every supported `kind` has a
 * checker; a repo populates its manifest only with the kinds it needs.
 *
 * Kinds:
 *   file-fork         vendored upstream file with local deviations;
 *                     drift = upstream moved since our fork SHA.
 *   version-pin       submodule pinned to a specific SHA/tag;
 *                     drift = upstream cut a new release (on default ref).
 *   feature-parity    local impl should match an upstream behavior;
 *                     three-pillar score: code + test + fixture snapshot.
 *   spec-conformance  local impl of an external spec at a known version.
 *   lang-parity       N sibling language ports of one spec;
 *                     drift = port diverged, or rejected anti-pattern
 *                     reintroduced on any port.
 *
 * Exit codes:
 *   0 — manifest valid, no drift.
 *   1 — schema violation, missing file, unreachable baseline, unknown kind.
 *   2 — drift (upstream moved, parity below floor, rejected anti-pattern).
 *
 * Output:
 *   Default — human-readable, compact per-area summary + detailed rows.
 *   `--format=json` or `--json` — single JSON object for CI tooling.
 *
 * Sources and learnings:
 *   - file-fork and version-pin semantics: socket-tui (this repo).
 *   - feature-parity three-pillar scoring: socket-sdxgen
 *     lock-step-features.json (snapshots replace the 20% tolerance).
 *   - lang-parity ports, rejected anti-pattern, per-area summaries, exit
 *     code 2 semantics: ultrathink/acorn/scripts/xlang-harness.mts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib/errors'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawnSync } from '@socketsecurity/lib/spawn'
import { validateSchema } from '@socketsecurity/lib/schema/validate'

import {
  XportManifestSchema,
  type FeatureParityRow,
  type FileForkRow,
  type LangParityRow,
  type PortStatus,
  type Row,
  type Site,
  type SpecConformanceRow,
  type Upstream,
  type VersionPinRow,
  type XportManifest,
} from './xport-schema.mts'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

type Manifest = XportManifest

// ---------------------------------------------------------------------------
// Report types — one per kind so dispatcher output is typed precisely.
// ---------------------------------------------------------------------------

type Severity = 'ok' | 'drift' | 'error'

interface ReportBase {
  area: string
  id: string
  severity: Severity
  messages: string[]
}

interface DriftCommit {
  sha: string
  summary: string
}

interface FileForkReport extends ReportBase {
  kind: 'file-fork'
  local: string
  upstream: string
  upstream_path: string
  forked_at_sha: string
  drift: DriftCommit[]
}

interface VersionPinReport extends ReportBase {
  kind: 'version-pin'
  upstream: string
  pinned_sha: string
  pinned_tag: string | null
  upgrade_policy: string
  head_sha: string | null
  drift_count: number
}

interface FeatureParityReport extends ReportBase {
  kind: 'feature-parity'
  upstream: string
  local_area: string
  criticality: number
  code_score: number
  test_score: number
  fixture_score: number
  total_score: number
}

interface SpecConformanceReport extends ReportBase {
  kind: 'spec-conformance'
  upstream: string
  local_impl: string
  spec_version: string
  spec_path: string | null
}

interface LangParityReport extends ReportBase {
  kind: 'lang-parity'
  category: string
  ports: Record<string, PortStatus>
}

type Report =
  | FileForkReport
  | VersionPinReport
  | FeatureParityReport
  | SpecConformanceReport
  | LangParityReport

// ---------------------------------------------------------------------------
// Generic helpers.
// ---------------------------------------------------------------------------

function readManifest(manifestPath: string): Manifest {
  if (!existsSync(manifestPath)) {
    logger.error(`xport: manifest not found at ${manifestPath}`)
    process.exit(1)
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    logger.error(`xport: could not parse ${manifestPath}`)
    logger.fail(`  ${errorMessage(e)}`)
    process.exit(1)
  }
  const result = validateSchema(XportManifestSchema, raw)
  if (result.ok) {
    return result.value
  }
  logger.error(`xport: schema validation failed for ${manifestPath}`)
  for (const issue of result.errors) {
    const loc = issue.path.length ? issue.path.join('.') : '<root>'
    logger.fail(`  ${loc}: ${issue.message}`)
  }
  process.exit(1)
}

/**
 * Resolve a manifest + all its `includes[]` sub-manifests into a single
 * flattened view. Each sub-manifest contributes its rows; the top-level
 * upstreams/sites maps are merged (top-level wins on conflict).
 */
function loadManifestTree(rootManifestPath: string): {
  areas: Array<{ area: string; manifest: Manifest }>
  merged: Manifest
} {
  const rootManifest = readManifest(rootManifestPath)
  const rootArea = rootManifest.area ?? 'root'
  const areas: Array<{ area: string; manifest: Manifest }> = [
    { area: rootArea, manifest: rootManifest },
  ]

  const includes = rootManifest.includes ?? []
  const baseDir = path.dirname(rootManifestPath)
  for (const rel of includes) {
    const subPath = path.resolve(baseDir, rel)
    const sub = readManifest(subPath)
    const area = sub.area ?? path.basename(rel, '.json').replace(/^xport-/, '')
    areas.push({ area, manifest: sub })
  }

  // Null-prototype maps guard against prototype pollution via untrusted
  // manifest keys. Double-cast through `unknown` so the
  // `exactOptionalPropertyTypes + noUncheckedIndexedAccess` strict
  // tsconfig in some repos accepts the `__proto__` sigil.
  const mergedUpstreams: Record<string, Upstream> = {
    __proto__: null,
  } as unknown as Record<string, Upstream>
  const mergedSites: Record<string, Site> = {
    __proto__: null,
  } as unknown as Record<string, Site>

  const mergedRows: Row[] = []
  // Include order, root last so it wins on duplicate keys.
  for (const { manifest } of [...areas.slice(1), ...areas.slice(0, 1)]) {
    for (const [k, v] of Object.entries(manifest.upstreams ?? {})) {
      mergedUpstreams[k] = v
    }
    for (const [k, v] of Object.entries(manifest.sites ?? {})) {
      mergedSites[k] = v
    }
  }
  for (const { manifest } of areas) {
    mergedRows.push(...manifest.rows)
  }
  return {
    areas,
    merged: {
      upstreams: mergedUpstreams,
      sites: mergedSites,
      rows: mergedRows,
    },
  }
}

function gitIn(submoduleDir: string, args: string[]): string {
  const result = spawnSync('git', ['-C', submoduleDir, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (status ${result.status}): ${String(result.stderr).trim()}`,
    )
  }
  return String(result.stdout)
}

function shaIsReachable(submoduleDir: string, sha: string): boolean {
  try {
    gitIn(submoduleDir, ['cat-file', '-e', sha])
    return true
  } catch {
    return false
  }
}

function driftCommitsSince(
  submoduleDir: string,
  sha: string,
  pathInRepo: string,
): DriftCommit[] {
  try {
    const out = gitIn(submoduleDir, [
      'log',
      '--pretty=format:%H%x09%s',
      `${sha}..HEAD`,
      '--',
      pathInRepo,
    ])
    const trimmed = out.trim()
    if (!trimmed) {
      return []
    }
    return trimmed.split('\n').map(line => {
      // Preserve any embedded tabs in the commit subject (rare but
      // possible) — `.split` destructuring would truncate at the
      // first tab inside the summary.
      const [commitSha, ...summaryParts] = line.split('\t')
      return {
        sha: commitSha ?? '',
        summary: summaryParts.join('\t') ?? '',
      }
    })
  } catch {
    return []
  }
}

function resolveUpstream(
  manifest: Manifest,
  alias: string,
  messages: string[],
): Upstream | null {
  const upstream = manifest.upstreams?.[alias]
  if (!upstream) {
    const known = Object.keys(manifest.upstreams ?? {}).join(', ') || '(none)'
    messages.push(`unknown upstream alias '${alias}' (known: ${known})`)
    return null
  }
  return upstream
}

function walkDirFiles(dir: string, extRe: RegExp): string[] {
  const files: string[] = []
  if (!existsSync(dir)) {
    return files
  }
  const stack: string[] = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: string[] = []
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') {
        continue
      }
      const full = path.join(current, entry)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(full)
      } else if (stat.isFile() && extRe.test(entry)) {
        files.push(full)
      }
    }
  }
  return files
}

function countPatternHits(files: string[], patterns: string[]): number {
  if (patterns.length === 0) {
    return 0
  }
  // Manifest authors occasionally land a bad regex; surface the bad
  // pattern and keep going rather than throwing a SyntaxError that
  // kills the whole run.
  const compiled: RegExp[] = []
  for (const p of patterns) {
    try {
      compiled.push(new RegExp(p))
    } catch (e) {
      logger.warn(
        `xport: skipping invalid regex ${JSON.stringify(p)}: ${errorMessage(e)}`,
      )
    }
  }
  let hits = 0
  for (const pat of compiled) {
    for (const file of files) {
      let content: string
      try {
        content = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      if (pat.test(content)) {
        hits += 1
        break
      }
    }
  }
  return hits
}

// ---------------------------------------------------------------------------
// Kind checkers.
// ---------------------------------------------------------------------------

function checkFileFork(
  row: FileForkRow,
  manifest: Manifest,
  area: string,
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

function checkVersionPin(
  row: VersionPinRow,
  manifest: Manifest,
  area: string,
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
    pinned_tag: row.pinned_tag ?? null,
    upgrade_policy: row.upgrade_policy,
    head_sha: null,
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
    const lines = remoteRefs.split('\n').filter(s => s.trim())
    const pref = [
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
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

function checkFeatureParity(
  row: FeatureParityRow,
  _manifest: Manifest,
  area: string,
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

function checkSpecConformance(
  row: SpecConformanceRow,
  manifest: Manifest,
  area: string,
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
    spec_path: row.spec_path ?? null,
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

function checkLangParity(
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
 * map. Zod's `XportManifestSchema.parse()` (called from `loadManifestTree`)
 * already covers per-row shape, enum values, id pattern, and required
 * fields — this is the referential-integrity layer on top.
 */
function checkCrossRowConsistency(
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

// ---------------------------------------------------------------------------
// Dispatcher.
// ---------------------------------------------------------------------------

function evaluate(
  rowsWithArea: Array<{ row: Row; area: string }>,
  merged: Manifest,
): Report[] {
  const reports: Report[] = []
  for (const { row, area } of rowsWithArea) {
    switch (row.kind) {
      case 'file-fork':
        reports.push(checkFileFork(row, merged, area))
        break
      case 'version-pin':
        reports.push(checkVersionPin(row, merged, area))
        break
      case 'feature-parity':
        reports.push(checkFeatureParity(row, merged, area))
        break
      case 'spec-conformance':
        reports.push(checkSpecConformance(row, merged, area))
        break
      case 'lang-parity':
        reports.push(checkLangParity(row, merged, area))
        break
      default: {
        const anyRow = row as { kind: string; id: string }
        reports.push({
          kind: 'file-fork',
          area,
          id: anyRow.id,
          severity: 'error',
          messages: [`no checker registered for kind '${anyRow.kind}'`],
          local: '',
          upstream: '',
          upstream_path: '',
          forked_at_sha: '',
          drift: [],
        })
        process.exitCode = 1
      }
    }
  }
  return reports
}

// ---------------------------------------------------------------------------
// Per-area summary (learned from ultrathink xlang-harness).
// ---------------------------------------------------------------------------

interface AreaSummary {
  area: string
  total: number
  ok: number
  drift: number
  error: number
}

function summarize(reports: Report[]): AreaSummary[] {
  const byArea = new Map<string, AreaSummary>()
  for (const r of reports) {
    let s = byArea.get(r.area)
    if (!s) {
      s = { area: r.area, total: 0, ok: 0, drift: 0, error: 0 }
      byArea.set(r.area, s)
    }
    s.total += 1
    s[r.severity] += 1
  }
  return [...byArea.values()].sort((a, b) => a.area.localeCompare(b.area))
}

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------

function emitHuman(reports: Report[], summaries: AreaSummary[]): number {
  logger.info(
    `xport — ${reports.length} row(s) across ${summaries.length} area(s)`,
  )
  logger.info('')
  for (const s of summaries) {
    const label = s.area.padEnd(24)
    const parts = `total=${String(s.total).padStart(3)}  ok=${String(s.ok).padStart(3)}  drift=${String(s.drift).padStart(3)}  error=${String(s.error).padStart(3)}`
    logger.info(`  ${label}${parts}`)
  }
  logger.info('')

  let hadError = false
  let hadDrift = false
  for (const r of reports) {
    const banner = `[${r.area}/${r.id}] (${r.kind})`
    if (r.kind === 'file-fork') {
      logger.info(banner)
      logger.info(`  local: ${r.local}`)
      logger.info(
        `  upstream: ${r.upstream}:${r.upstream_path} @ ${r.forked_at_sha.slice(0, 12)}`,
      )
    } else if (r.kind === 'version-pin') {
      logger.info(banner)
      const tag = r.pinned_tag ? ` (${r.pinned_tag})` : ''
      logger.info(
        `  upstream: ${r.upstream} @ ${r.pinned_sha.slice(0, 12)}${tag}, policy=${r.upgrade_policy}`,
      )
    } else if (r.kind === 'feature-parity') {
      logger.info(banner)
      logger.info(
        `  upstream: ${r.upstream}, local_area: ${r.local_area}, criticality: ${r.criticality}`,
      )
      logger.info(
        `  scores: code=${r.code_score} test=${r.test_score} fixture=${r.fixture_score} total=${r.total_score}`,
      )
    } else if (r.kind === 'spec-conformance') {
      logger.info(banner)
      logger.info(
        `  upstream: ${r.upstream}, local_impl: ${r.local_impl}, spec_version: ${r.spec_version}`,
      )
    } else if (r.kind === 'lang-parity') {
      logger.info(banner)
      logger.info(`  category: ${r.category}`)
      for (const [port, state] of Object.entries(r.ports)) {
        const suffix =
          state.status === 'opt-out' ? ` (${state.reason ?? ''})` : ''
        logger.info(`    ${port}: ${state.status}${suffix}`)
      }
    }

    for (const msg of r.messages) {
      if (r.severity === 'error') {
        logger.fail(`  ${msg}`)
      } else if (r.severity === 'drift') {
        logger.warn(`  ${msg}`)
      } else {
        logger.info(`  ${msg}`)
      }
    }

    if (r.kind === 'file-fork') {
      for (const c of r.drift) {
        logger.info(`    ${c.sha.slice(0, 12)} ${c.summary}`)
      }
    }

    if (r.severity === 'ok') {
      logger.success(`  ok`)
    } else if (r.severity === 'error') {
      hadError = true
    } else if (r.severity === 'drift') {
      hadDrift = true
    }
    logger.info('')
  }

  if (hadError) {
    return 1
  }
  if (hadDrift) {
    return 2
  }
  return 0
}

function main(): void {
  const rootManifestPath = path.join(rootDir, 'xport.json')
  const { areas, merged } = loadManifestTree(rootManifestPath)

  const rowsWithArea: Array<{ row: Row; area: string }> = []
  for (const { area, manifest } of areas) {
    for (const row of manifest.rows) {
      rowsWithArea.push({ row, area })
    }
  }

  const crossRowErrors = checkCrossRowConsistency(rowsWithArea, merged)
  if (crossRowErrors.length > 0) {
    for (const err of crossRowErrors) {
      logger.fail(err)
    }
    logger.error(
      `xport: ${crossRowErrors.length} cross-row error(s) — fix before running drift checks`,
    )
    process.exit(1)
  }

  const reports = evaluate(rowsWithArea, merged)
  const summaries = summarize(reports)

  const jsonMode =
    process.argv.includes('--json') || process.argv.includes('--format=json')

  if (jsonMode) {
    process.stdout.write(JSON.stringify({ reports, summaries }, null, 2) + '\n')
    const anyError = reports.some(r => r.severity === 'error')
    const anyDrift = reports.some(r => r.severity === 'drift')
    if (anyError) {
      process.exitCode = 1
    } else if (anyDrift) {
      process.exitCode = 2
    }
    return
  }

  const code = emitHuman(reports, summaries)
  if (code !== 0) {
    process.exitCode = code
  }
}

main()
