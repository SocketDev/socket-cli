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
 * sha256:…` annotation via gen-gitmodules-hash.mts --set, and commit
 * `chore(deps): bump <upstream> to <tag>`. Collapses reference.md Phase 3
 * (the bash the skill used to inline). The skill still owns the per-row
 * test gate + the locked-row human approval (it only calls --apply for an
 * already-approved, validated row); the deterministic git + edit + commit
 * mechanics live here so they are tested, not re-typed per run.
 */

import process from 'node:process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import {
  listManifestFiles,
  loadManifestTree,
  readManifest,
  resolveManifestRoot,
} from './manifest.mts'

import type { Manifest, Report, VersionPinReport } from './types.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

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

// ---------------------------------------------------------------------------
// --apply orchestration. The deterministic git + edit + commit mechanics for
// landing one already-resolved, already-approved bump. Shared annotation helper
// (`gitmodulesLabelForTag`) is used by both the apply path and the skill's
// advisory prose so the `# <name>-<version>` label is computed one way.
// ---------------------------------------------------------------------------

export interface ApplyOptions {
  id: string
  manifestPath: string
  repoRoot: string
  /**
   * Stable tag to bump to. Exactly one of targetTag / targetSha must be set.
   */
  targetTag?: string | undefined
  /**
   * Default-branch commit SHA to bump to (the plan's HEAD leg for tagless /
   * already-past-tag track-latest rows). The row's `pinned_tag` is REMOVED —
   * a SHA pin has no release label.
   */
  targetSha?: string | undefined
}

export interface ApplyResult {
  committed: boolean
  gitmodulesLabel: string
  pinnedSha: string
  state:
    | 'bumped'
    | 'skipped-already-at-target'
    | 'skipped-no-row'
    | 'skipped-no-submodule'
    | 'skipped-target-behind-pin'
  submodulePath: string | undefined
  targetTag: string
}

/**
 * Date-heuristic backward detector — the belt behind classifyTarget for
 * shallow grafts, where `merge-base --is-ancestor` returns a definitive-
 * looking false instead of erroring. A target whose committer date is more
 * than a day older than the pin's is a suspected downgrade. Pure; epochs in
 * seconds. The one-day allowance absorbs rebase/cherry-pick timestamp skew
 * on genuinely-forward targets.
 */
export function isSuspectBackward(
  pinEpoch: number,
  targetEpoch: number,
): boolean {
  const daySeconds = 86_400
  return targetEpoch < pinEpoch - daySeconds
}

/**
 * Three-way target classification against the current pin. Pure — the
 * ancestry probe is injected so the unit is testable without a git fixture.
 * `isAncestor(a, b)` answers "is commit a an ancestor of commit b" and
 * returns undefined when ancestry is unknowable (shallow clone) — unknown
 * proceeds forward, matching the harness's drift-forwardness guarantee.
 */
export function classifyTarget(
  pinnedSha: string,
  targetCommitSha: string,
  isAncestor: (a: string, b: string) => boolean | undefined,
): 'already-at-target' | 'forward' | 'target-behind-pin' {
  if (targetCommitSha === pinnedSha) {
    return 'already-at-target'
  }
  if (isAncestor(targetCommitSha, pinnedSha) === true) {
    return 'target-behind-pin'
  }
  return 'forward'
}

// The `# <name>-<version>` label gen-gitmodules-hash.mts --set stamps above the
// submodule block: the submodule's basename + the target tag. Pure so the
// advisory prose and the apply write agree on one label.
export function gitmodulesLabelForTag(
  submodulePath: string,
  targetTag: string,
): string {
  return `${path.basename(submodulePath)}-${targetTag}`
}

function runGit(repoRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
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

// Locate the version-pin row + its submodule path in the manifest. Returns
// undefined for either when the id is unknown or its upstream has no submodule
// — the apply path turns those into a skipped (not thrown) result so a stale id
// from a re-run plan is a no-op, not a crash.
function findVersionPinRow(
  manifest: Manifest,
  id: string,
): { submodulePath: string | undefined; upstreamAlias: string } | undefined {
  for (let i = 0, rows = manifest.rows, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    if (row.kind === 'version-pin' && row.id === id) {
      const upstream = manifest.upstreams?.[row.upstream]
      return {
        submodulePath: upstream?.submodule,
        upstreamAlias: row.upstream,
      }
    }
  }
  return undefined
}

// Rewrite ONE version-pin row's `pinned_tag` + `pinned_sha` in the manifest
// JSON, preserving the file's existing 2-space formatting + trailing newline.
// A pinnedTag of `undefined` DELETES the row's pinned_tag (SHA pins carry no
// release label).
export function writePinnedFields(
  manifestPath: string,
  id: string,
  options: { pinnedSha: string; pinnedTag: string | undefined },
): void {
  const { pinnedSha, pinnedTag } = { __proto__: null, ...options } as {
    pinnedSha: string
    pinnedTag: string | undefined
  }
  const raw = readFileSync(manifestPath, 'utf8')
  const trailingNewline = raw.endsWith('\n')
  const parsed: unknown = JSON.parse(raw)
  const manifest = parsed as Manifest
  for (let i = 0, rows = manifest.rows, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    if (row.kind === 'version-pin' && row.id === id) {
      row.pinned_sha = pinnedSha
      if (pinnedTag === undefined) {
        delete row.pinned_tag
      } else {
        row.pinned_tag = pinnedTag
      }
    }
  }
  const serialized = JSON.stringify(manifest, undefined, 2)
  writeFileSync(manifestPath, trailingNewline ? `${serialized}\n` : serialized)
}

// Land one resolved bump. Checkout the target tag in the submodule, resolve its
// commit SHA, rewrite the manifest row, regenerate the .gitmodules annotation,
// then commit. The caller (skill) is responsible for the test gate + locked-row
// approval BEFORE calling this — apply is the deterministic write half.
export function applyBump(options: ApplyOptions): ApplyResult {
  const opts = { __proto__: null, ...options } as ApplyOptions
  const { id, manifestPath, repoRoot, targetSha, targetTag } = opts
  if ((targetTag === undefined) === (targetSha === undefined)) {
    throw new Error(
      'applyBump: exactly one of targetTag / targetSha must be set',
    )
  }
  const targetLabel = targetTag ?? targetSha!.slice(0, 12)
  const manifest = readManifest(manifestPath)
  const found = findVersionPinRow(manifest, id)
  if (!found) {
    return {
      committed: false,
      gitmodulesLabel: '',
      pinnedSha: '',
      state: 'skipped-no-row',
      submodulePath: undefined,
      targetTag: targetLabel,
    }
  }
  const { submodulePath } = found
  if (!submodulePath) {
    return {
      committed: false,
      gitmodulesLabel: '',
      pinnedSha: '',
      state: 'skipped-no-submodule',
      submodulePath: undefined,
      targetTag: targetLabel,
    }
  }
  const submoduleDir = path.join(repoRoot, submodulePath)
  // Fetch then resolve the target commit — a shallow submodule may not have
  // the tag / SHA yet. SHA targets were fetched by the caller's default-branch
  // fetch; the extra fetch here is belt-and-suspenders for tag targets.
  runGit(submoduleDir, ['fetch', '--tags', '--quiet'])
  const targetCommit = targetTag
    ? runGit(submoduleDir, ['rev-parse', `${targetTag}^{commit}`]).trim()
    : targetSha!
  // Guard: never re-apply a no-op or move a pin BACKWARD (a monorepo sibling
  // tag or an already-past-tag pin would otherwise regress — babel/flow case).
  const currentPin = runGit(submoduleDir, ['rev-parse', 'HEAD']).trim()
  const verdict = classifyTarget(currentPin, targetCommit, (a, b) => {
    const probe = spawnSync(
      'git',
      ['-C', submoduleDir, 'merge-base', '--is-ancestor', a, b],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )
    if (probe.status === 0) {
      return true
    }
    if (probe.status === 1) {
      return false
    }
    // Shallow clone / unrelated histories — ancestry unknowable.
    return undefined
  })
  if (verdict !== 'forward') {
    return {
      committed: false,
      gitmodulesLabel: '',
      pinnedSha: currentPin,
      state:
        verdict === 'already-at-target'
          ? 'skipped-already-at-target'
          : 'skipped-target-behind-pin',
      submodulePath,
      targetTag: targetLabel,
    }
  }
  // Belt for shallow grafts: `merge-base --is-ancestor` on two disconnected
  // depth-1 tips exits 1 — a DEFINITIVE-looking "not an ancestor" — so a
  // genuinely-backward target can read as 'forward'. Committer dates survive
  // shallow fetches on each tip; a target meaningfully OLDER than the pin is
  // a suspected downgrade and needs a human, not an auto-apply.
  const pinEpoch = Number(
    runGit(submoduleDir, ['show', '-s', '--format=%ct', currentPin]).trim(),
  )
  const targetEpoch = Number(
    runGit(submoduleDir, ['show', '-s', '--format=%ct', targetCommit]).trim(),
  )
  if (
    Number.isFinite(pinEpoch) &&
    Number.isFinite(targetEpoch) &&
    isSuspectBackward(pinEpoch, targetEpoch)
  ) {
    return {
      committed: false,
      gitmodulesLabel: '',
      pinnedSha: currentPin,
      state: 'skipped-target-behind-pin',
      submodulePath,
      targetTag: targetLabel,
    }
  }
  runGit(submoduleDir, ['checkout', '--quiet', targetCommit])
  const pinnedSha = runGit(submoduleDir, ['rev-parse', 'HEAD']).trim()
  // Label: tags label as `<basename>-<tag>`; SHA pins label with the commit
  // DATE (`<basename>-YYYY.MM.DD`, from %cs — reproducible, no wall clock),
  // matching the fleet's existing date-style .gitmodules annotations.
  const gitmodulesLabel = targetTag
    ? gitmodulesLabelForTag(submodulePath, targetTag)
    : `${path.basename(submodulePath)}-${runGit(submoduleDir, [
        'show',
        '-s',
        '--format=%cs',
        pinnedSha,
      ])
        .trim()
        .replaceAll('-', '.')}`

  writePinnedFields(manifestPath, id, {
    pinnedSha,
    pinnedTag: targetTag,
  })

  // Regenerate the `# <name>-<version> sha256:…` annotation. gen-gitmodules-hash
  // --set bumps the block's ref AND recomputes the archive hash in one write —
  // the only annotation path uses-sha-verify-guard accepts.
  const gen = spawnSync(
    'node',
    [
      'scripts/fleet/gen-gitmodules-hash.mts',
      '--set',
      submodulePath,
      pinnedSha,
      '--label',
      gitmodulesLabel,
      path.join(repoRoot, '.gitmodules'),
    ],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], stdioString: true },
  )
  if (gen.error) {
    throw gen.error
  }
  if (gen.status !== 0) {
    throw new Error(
      `gen-gitmodules-hash --set failed (status ${gen.status}): ${String(gen.stderr).trim()}`,
    )
  }

  const upstreamAlias = found.upstreamAlias
  // Tag bumps read `bump <upstream> to <tag>`; HEAD bumps read
  // `bump <upstream> to <short-sha> (<commit-date>)`.
  const commitTarget = targetTag
    ? targetTag
    : `${pinnedSha.slice(0, 12)} (${runGit(submoduleDir, ['show', '-s', '--format=%cs', pinnedSha]).trim()})`
  runGit(repoRoot, [
    'commit',
    '-o',
    submodulePath,
    '-o',
    manifestPath,
    '-o',
    path.join(repoRoot, '.gitmodules'),
    '-m',
    `chore(deps): bump ${upstreamAlias} to ${commitTarget}`,
  ])

  return {
    committed: true,
    gitmodulesLabel,
    pinnedSha,
    state: 'bumped',
    submodulePath,
    targetTag: targetLabel,
  }
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
