/**
 * @file Release-prep step: derive the next version from the Conventional
 *   Commits since the last release tag, generate the CHANGELOG entry from those
 *   same commits, write `package.json` + `CHANGELOG.md`, and commit `chore:
 *   bump version to X.Y.Z`. The CHANGELOG's derived side is DERIVED here, never
 *   hand-written, so it can't drift ahead of the tag (the failure mode that
 *   shipped a 6.0.9 entry describing work that landed after the 6.0.9 tag).
 *   Hand-written notes have exactly one home — the `## [Unreleased]` section —
 *   and the bump UNIONS them with the derived bullets at promotion time
 *   (composeReleaseSection), so neither source can drop the other: sdk 4.0.2's
 *   cached-scan feature shipped undocumented when its hand bullets lived in
 *   [Unreleased], its commits were chore-typed, and strict regeneration
 *   dropped the hand side. The tag + GitHub
 *   release are created later, at publish/approve time, by `publish.mts`
 *   (`ensureTagAndRelease`) / the provenance workflow — this step only prepares
 *   the bump commit.
 *   ORDERING INVARIANT (bump-exactly-once): the bump — version + CHANGELOG
 *   section — happens LOCALLY, at release time, exactly once; CI never
 *   re-derives it, the re-entry no-op below refuses a second write. A
 *   section written early in CI while main advanced underneath went stale
 *   (packageurl-js 1.4.5 shipped a changelog missing later commits); deriving
 *   at the moment the release is cut means the section and the released
 *   commits are the same set by construction. The drift check
 *   (check/changelog-is-commit-derived.mts) verifies the committed section by
 *   re-running the SAME `deriveReleaseCommits` path exported here — one
 *   derivation implementation, so generation and verification cannot
 *   disagree. The range anchor never silently widens: see `ReleaseAnchor` in
 *   lib/release-anchor.mts (tag → bump commit → registry publish time, else
 *   stop loud), the shared chain this file binds to the npm registry.
 *   Release flow: node scripts/fleet/bump.mts # version +
 *   CHANGELOG + bump commit git push # land the bump <trigger publish workflow>
 *
 *   # CI: stage publish (OIDC + provenance) node scripts/fleet/npm-publish.mts
 *
 *   --approve # local 2FA promote + tag --write-only writes package.json +
 *   CHANGELOG but skips the commit, for the provenance workflow's CI bump stage
 *   (CI commits them via the GitHub API, since main requires signed commits and
 *   CI has no signing key). Usage: node scripts/fleet/bump.mts [--dry-run]
 *   [--release-as <level>] [--write-only]
 */

import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { gt } from '@socketsecurity/lib-stable/versions/compare'

import { decidePlaceholderRelease } from './bump/placeholder-release.mts'
import { applyLockstepBump } from './bump/lockstep-write.mts'
import {
  BUMP_USAGE,
  resolveBumpInvocation,
  unrecognizedFlagsMessage,
} from './bump/invocation.mts'
import {
  changelogHasVersionSection,
  changelogVersionSections,
  composeReleaseSection,
  dropUnreleasedChangelogSections,
  insertChangelogSection,
  replaceVersion,
} from './bump/changelog-sections.mts'
import { findBackupBranchesWithUnreleasedCommits } from './backup-branches/naming.mts'
import {
  bumpLevelFor,
  changelogHeading,
  computeNextVersion,
  repoBaseUrl,
  sectionHasEntries,
  UNRELEASED_HEADING,
  versionHintFrom,
  withChangelogEntry,
} from './lib/changelog.mts'
import {
  deriveReleaseCommits as deriveAnchoredReleaseCommits,
  describeAnchor,
  findVersionFlipCommit as findAnchorVersionFlipCommit,
} from './lib/release-anchor.mts'
import { loadSocketWheelhouseConfig, REPO_ROOT } from './paths.mts'
import {
  fetchLatestPublishedVersionChecked,
  fetchRegistryReleaseState,
} from './publish-infra/npm/registry.mts'
import { resolveNpmWorkspaceLayout } from './publish-infra/npm/workspace.mts'
import { runCapture } from './publish-infra/shared.mts'

import type {
  BackupBranchGitExec,
  BackupBranchUnreleased,
} from './backup-branches/naming.mts'
import type { BumpLevel, ConventionalCommit } from './lib/changelog.mts'
import type { ReleaseDerivation, ReleaseLane } from './lib/release-anchor.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { writeThroughMirrorLock } from './_shared/mirror-lock.mts'
import { runMain } from './_shared/run-main.mts'
import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()
const rootPath = REPO_ROOT

interface PackageJsonShape {
  name?: string | undefined
  repository?: { url?: string | undefined } | string | undefined
  version?: string | undefined
}

/**
 * The npm binding of the shared anchor chain (lib/release-anchor.mts): the
 * version flip lives in the version-source manifest's root `version` (the
 * root package.json by default; a multi-package workspace passes its
 * version-source manifest path), the publish ledger is the npm packument
 * (`dist-tags.latest` + the `time` map). A missing `packageName` means the
 * registry has nothing to say — a genuine first release derives from the
 * manifest alone.
 */
export function npmReleaseLane(
  packageName: string | undefined,
  manifestPath = 'package.json',
): ReleaseLane {
  return {
    async fetchLatest() {
      if (!packageName) {
        return { latest: undefined, reachable: true }
      }
      return await fetchLatestPublishedVersionChecked(packageName)
    },
    async fetchPublishedAt(version) {
      if (!packageName) {
        return undefined
      }
      const state = await fetchRegistryReleaseState(packageName)
      return state?.timeMap[version]
    },
    manifestPath,
    parseManifestVersion(text) {
      try {
        const parsed = JSON.parse(text) as { version?: string | undefined }
        return typeof parsed.version === 'string' ? parsed.version : undefined
      } catch {
        return undefined
      }
    },
  }
}

/**
 * The commit that FLIPPED the repo's VERSION-SOURCE manifest to `version` —
 * the npm binding of the shared flip probe, kept exported for the tag-gap
 * reconciler (release-pipeline/reconcile-gap.mts). The manifest comes from
 * the workspace layout, not a hard-coded root `package.json`: a private
 * workspace root carries no version, so its releases flip the MAIN member's
 * manifest (decmpfs bumps `napi/decmpfs/package.json`) and a root-only probe
 * would never find the commit to tag.
 */
export async function findVersionFlipCommit(
  version: string,
  cwd: string = rootPath,
): Promise<string | undefined> {
  const layout = resolveNpmWorkspaceLayout(cwd)
  return await findAnchorVersionFlipCommit(
    npmReleaseLane(undefined, layout.versionSource.relManifestPath),
    version,
    cwd,
  )
}

/**
 * THE single npm-lane derivation code path for a release's commit set — used
 * by both the generator (`bump.mts` main) and the verifier
 * (`check/changelog-is-commit-derived.mts`), so the CHANGELOG a bump writes
 * and the CHANGELOG the drift check expects can never disagree: same base,
 * same anchor chain, same commit stream, same parser. Returns `undefined`
 * when a previous release exists but no anchor resolves, or when the registry
 * is unreachable, offline the released base cannot be confirmed — never
 * widen to an older tag.
 */
export async function deriveReleaseCommits(config: {
  cwd?: string | undefined
  manifestPath?: string | undefined
  manifestVersion: string
  packageName?: string | undefined
}): Promise<ReleaseDerivation | undefined> {
  const {
    cwd = rootPath,
    manifestPath = 'package.json',
    manifestVersion,
    packageName,
  } = {
    __proto__: null,
    ...config,
  } as {
    cwd?: string | undefined
    manifestPath?: string | undefined
    manifestVersion: string
    packageName?: string | undefined
  }
  return await deriveAnchoredReleaseCommits({
    cwd,
    lane: npmReleaseLane(packageName, manifestPath),
    manifestVersion,
  })
}

function readPackageJson(): { raw: string; parsed: PackageJsonShape } {
  const raw = readFileSync(path.join(rootPath, 'package.json'), 'utf8')
  return { parsed: JSON.parse(raw) as PackageJsonShape, raw }
}

// Commit types a release treats as invisible: they carry no user-facing
// change, so a release made only of these needs an operator-named entry.
const DERIVATION_INVISIBLE_TYPES = new Set(['chore', 'style', 'test'])

/**
 * The commits invisible to changelog derivation that still touch source:
 * typed chore/style/test yet carrying changes under `srcDir`. Breaking
 * commits are excluded — a `chore!:` lands in the derived section under
 * Changed, so it is not invisible. `touchedFiles` maps commit hash → the
 * files that commit touched. Pure over its inputs; the bump collects the
 * file lists from git and WARNS (never fails — a chore commit touching src/
 * is often genuinely internal).
 */
export function invisibleSrcCommits(
  commits: readonly ConventionalCommit[],
  touchedFiles: ReadonlyMap<string, readonly string[]>,
  srcDir = 'src',
): ConventionalCommit[] {
  const prefix = `${srcDir}/`
  const out: ConventionalCommit[] = []
  for (let i = 0, { length } = commits; i < length; i += 1) {
    const commit = commits[i]!
    if (!DERIVATION_INVISIBLE_TYPES.has(commit.type) || commit.breaking) {
      continue
    }
    const files = touchedFiles.get(commit.hash)
    if (files?.some(f => f.startsWith(prefix))) {
      out.push(commit)
    }
  }
  return out
}

/**
 * The files each of `hashes` touched, via `git diff-tree` per commit. Feeds
 * `invisibleSrcCommits`; a git failure yields an empty list for that hash
 * the warning is best-effort, never a release blocker.
 */
export async function collectTouchedFiles(
  hashes: readonly string[],
  cwd: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  for (const hash of hashes) {
    // eslint-disable-next-line no-await-in-loop -- serial per-commit git probe; the candidate list is short
    const r = await runCapture(
      'git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', hash],
      cwd,
    )
    out.set(
      hash,
      r.code === 0
        ? r.stdout
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
        : [],
    )
  }
  return out
}

/**
 * Warn — never fail — about chore/style/test commits that touch src/: they
 * are invisible to changelog derivation, so user-facing work committed under
 * them ships undocumented unless a hand-written `[Unreleased]` bullet covers
 * it. Prints to the log and, when the bump runs in CI, to the job summary
 * via GITHUB_STEP_SUMMARY.
 */
export function warnDerivationInvisibleCommits(
  invisible: readonly ConventionalCommit[],
  anchorLabel: string,
): void {
  if (invisible.length === 0) {
    return
  }
  const named = invisible.map(
    c =>
      `  ${c.hash.slice(0, 7)} ${c.type}${c.scope ? `(${c.scope})` : ''}: ${c.description}`,
  )
  const body =
    `${invisible.length} commit(s) since ${anchorLabel} touch src/ but are ` +
    `typed chore/style/test — invisible to changelog derivation. If they ` +
    `carry user-facing work, add bullets under "${UNRELEASED_HEADING}" in ` +
    `CHANGELOG.md or retype the commits:\n${named.join('\n')}`
  logger.warn(body)
  const summaryPath = process.env['GITHUB_STEP_SUMMARY']
  if (summaryPath) {
    try {
      appendFileSync(
        summaryPath,
        `### bump warning: derivation-invisible commits\n\n${body}\n`,
      )
    } catch (e) {
      logger.warn(`Could not append the CI job summary: ${e}`)
    }
  }
}

/**
 * Warn — loud, never fail — when a fleet backup / recovery branch carries
 * commits `baseRef` can't reach. A release derives its CHANGELOG from the
 * commits reachable from HEAD; work parked on a `backup-*` / `backup/*` branch
 * and never landed would ship SILENTLY OMITTED — the lose-work failure the
 * fleet guards against. Surfaces to the log and, in CI, the job summary via
 * GITHUB_STEP_SUMMARY. Never auto-merges: landing or discarding the backup is
 * the operator's call. The git exec is injected so the whole path is unit
 * testable without real branches. Runs pre-derive, before any file is written,
 * so `--dry-run` surfaces the same warning with no side effects.
 */
export async function warnBackupBranchesWithUnreleased(
  baseRef: string,
  exec: BackupBranchGitExec,
): Promise<void> {
  let found: BackupBranchUnreleased[]
  try {
    found = await findBackupBranchesWithUnreleasedCommits(baseRef, exec)
  } catch {
    // The scan is best-effort — a git failure never blocks the release.
    return
  }
  if (found.length === 0) {
    return
  }
  const detail = found
    .map(
      b =>
        `  ${b.branch} — ${b.commits.length} commit(s) not on ${baseRef}:\n` +
        b.commits.map(c => `      ${c}`).join('\n'),
    )
    .join('\n')
  const body =
    `${found.length} backup branch(es) carry commit(s) NOT reachable from ` +
    `${baseRef} — a release cut now would SILENTLY OMIT that parked work:\n` +
    `${detail}\n` +
    `  Fix: land the backup branch (merge / cherry-pick into ${baseRef}) or ` +
    `discard it before releasing — the bump never auto-merges backup work.`
  logger.warn(body)
  const summaryPath = process.env['GITHUB_STEP_SUMMARY']
  if (summaryPath) {
    try {
      appendFileSync(
        summaryPath,
        `### bump warning: backup branches with unreleased commits\n\n${body}\n`,
      )
    } catch (e) {
      logger.warn(`Could not append the CI job summary: ${e}`)
    }
  }
}

async function main(): Promise<void> {
  // The CLI preamble — usage, unknown-flag refusal, flag resolution — is
  // resolveBumpInvocation, so those branches are assertable without running
  // a bump. main() only plumbs the decision to output and an exit code.
  const invocation = resolveBumpInvocation(process.argv.slice(2))
  if (invocation.kind === 'usage') {
    logger.log(BUMP_USAGE)
    return
  }
  if (invocation.kind === 'refuse') {
    logger.fail(unrecognizedFlagsMessage(invocation.unknownFlags))
    process.exitCode = 1
    return
  }
  const { dryRun, emptyChangelogEntry, releaseAs, writeOnly } = invocation

  const { parsed: rootPkg, raw: pkgRaw } = readPackageJson()
  // The publish layout decides the bump subject: a single-package repo bumps
  // the root manifest exactly as before; a multi-package workspace (decmpfs,
  // stuie — private/versionless root, publishable members) bumps its VERSION
  // SOURCE, root when it carries a version, else the main package, and
  // writes every publishable manifest in lockstep below. Resolution fails
  // LOUD when the repo has no publishable subject at all.
  const layout = resolveNpmWorkspaceLayout(rootPath)
  const multi = layout.kind === 'multi'
  const pkg: PackageJsonShape = multi
    ? {
        name: layout.versionSource.name,
        repository: layout.repository,
        version: layout.versionSource.version,
      }
    : rootPkg
  if (!pkg.version) {
    logger.fail('package.json has no version field.')
    process.exitCode = 1
    return
  }

  // PRE-DERIVE: surface any backup / recovery branch carrying commits HEAD
  // can't reach. The derivation below only sees commits reachable from HEAD, so
  // work parked on a `backup-*` / `backup/*` branch would be silently omitted
  // from the release. Loud warning, never a merge — the operator lands or
  // discards the backup. Runs before any write, so --dry-run surfaces it too.
  await warnBackupBranchesWithUnreleased('HEAD', args =>
    runCapture('git', args, rootPath),
  )

  // ONE derivation resolves the released base (registry latest + last tag,
  // NEVER the manifest — a pre-bumped package.json would otherwise skip a
  // version), the range anchor, and the commit set. The drift check
  // (changelog-is-commit-derived) re-runs this SAME function, so generation
  // and verification cannot diverge.
  const derivation = await deriveReleaseCommits({
    // Single layouts keep the root-manifest flip probe byte-identical to the
    // old behavior; only a multi layout anchors on its version source.
    manifestPath: multi ? layout.versionSource.relManifestPath : 'package.json',
    manifestVersion: pkg.version,
    packageName: pkg.name,
  })
  if (!derivation) {
    logger.fail(
      `Cannot anchor the changelog range: either the registry is unreachable ` +
        `(offline, the released base cannot be confirmed and \`git describe\` ` +
        `may resolve an OLDER tag), or a previous release exists but its ` +
        `v-tag is missing (or off-lineage), no bump commit for it is ` +
        `reachable, and the registry publish time is unavailable. Re-run ` +
        `online, or restore the previous release's tag (git tag v<version> ` +
        `<release-commit> && git push origin --tags) — deriving from an ` +
        `OLDER tag would re-list already-shipped commits.`,
    )
    process.exitCode = 1
    return
  }
  const { anchor, base, commits } = derivation
  // Safety-net WARNING, never red: chore/style/test commits that touch src/
  // are invisible to derivation — if they carry user-facing work it needs a
  // hand-written [Unreleased] bullet or a retype, else it ships undocumented
  // (the sdk 4.0.2 incident shape).
  const invisibleCandidates = commits.filter(
    c => DERIVATION_INVISIBLE_TYPES.has(c.type) && !c.breaking,
  )
  warnDerivationInvisibleCommits(
    invisibleSrcCommits(
      invisibleCandidates,
      await collectTouchedFiles(
        invisibleCandidates.map(c => c.hash),
        rootPath,
      ),
    ),
    describeAnchor(anchor),
  )
  const changelogPath = path.join(rootPath, 'CHANGELOG.md')
  let existingChangelog = readFileSync(changelogPath, 'utf8')

  // PLACEHOLDER STATE, decided before the level heuristic runs: a package that
  // has never shipped and still carries its scaffolded version — `0.0.0`, or a
  // `X.Y.Z-prerelease` — releases 0.1.0 first. The heuristic cannot answer
  // here: with no released base the whole history is in range, so one `feat!`
  // asks for a major, an all-`fix` stream asks for 0.0.1, and an all-`chore`
  // stream asks for nothing. The reasoning is announced before any write, so
  // --dry-run shows it too, and an explicit --release-as always outranks it.
  const placeholderRelease = decidePlaceholderRelease({
    changelogVersions: changelogVersionSections(existingChangelog),
    hasPriorRelease: anchor.kind !== 'first-release',
    manifestVersion: pkg.version,
    releaseAs: typeof releaseAs === 'string' ? releaseAs : undefined,
  })
  for (const line of placeholderRelease.announcement) {
    logger.log(line)
  }
  if (placeholderRelease.warning) {
    logger.warn(placeholderRelease.warning)
  }

  // Version resolution, most-explicit first: the placeholder decision above,
  // then the --release-as flag, then a committed version HINT (package.json
  // version carrying a prerelease suffix, e.g. `6.0.10-prerelease` → release
  // 6.0.10), then the commit-type heuristic. MAJOR is never derived and a hint cannot smuggle one in: a
  // major jump always needs the explicit flag (agent runs are hook-gated on
  // the user's typed authorization; CI on the dispatch input).
  // Release version policy from the canonical config (the wheelhouse's own
  // `.config/repo/` location as well as the member `.config/`). `patch-only`
  // clamps a commit-derived minor down to a patch below; a `X.Y.Z-prerelease`
  // hint or an explicit --release-as is the deliberate escape to a higher bump.
  const versionPolicy = (
    loadSocketWheelhouseConfig(REPO_ROOT)?.value as
      | { release?: { versionPolicy?: string | undefined } | undefined }
      | undefined
  )?.release?.versionPolicy
  const hinted = versionHintFrom(pkg.version)
  let level: BumpLevel | undefined
  let hintedVersion: string | undefined
  // How the log line describes where the version came from. The placeholder
  // path derives no SemVer level, so it names its own reason instead.
  let levelLabel: string | undefined
  if (placeholderRelease.version) {
    // The base guards below — the `gt(x, base)` advance check and the
    // major-jump refusal — all measure against a RELEASED base. A placeholder
    // has released nothing, so `base` is just the manifest core and those
    // guards have nothing to check. Skipped rather than satisfied.
    hintedVersion = placeholderRelease.version
    levelLabel = 'first release from the placeholder version'
  } else if (typeof releaseAs === 'string') {
    if (
      releaseAs === 'major' ||
      releaseAs === 'minor' ||
      releaseAs === 'patch'
    ) {
      level = releaseAs
    } else if (/^\d+\.\d+\.\d+$/.test(releaseAs)) {
      // An exact `--release-as X.Y.Z` names the landing version outright —
      // the release pipeline forwards the USER-named version this way, since
      // translating it into a level is lossy (bump.mts increments from the
      // released base, never the manifest, so base+level can land somewhere
      // other than the named version). Same guardrails as a committed hint.
      const baseMajor = base.split('.')[0]
      if (releaseAs.split('.')[0] !== baseMajor) {
        logger.fail(
          `--release-as ${releaseAs} is a MAJOR jump past the last released ` +
            `version ${base} — a major requires the explicit --release-as ` +
            `major signal, not an exact version.`,
        )
        process.exitCode = 1
        return
      }
      if (!gt(releaseAs, base)) {
        logger.fail(
          `--release-as ${releaseAs} is not ahead of the last released ` +
            `version ${base} — it would re-publish or move backward. ` +
            `Name a version greater than ${base}.`,
        )
        process.exitCode = 1
        return
      }
      hintedVersion = releaseAs
      level = 'patch'
      logger.log(`--release-as names the exact landing version ${releaseAs}.`)
    } else {
      logger.fail(
        `--release-as must be major | minor | patch or an exact X.Y.Z ` +
          `version (got "${releaseAs}").`,
      )
      process.exitCode = 1
      return
    }
  } else if (hinted) {
    // Compare the hint's major against the LAST RELEASED version (`base`), not
    // the manifest — `hinted` is the manifest with its suffix stripped, so its
    // major always equals the manifest's; comparing them was dead code that let
    // a `X.0.0-prerelease` hint smuggle a major past the "MAJOR never derived"
    // rule.
    const baseMajor = base.split('.')[0]
    if (hinted.split('.')[0] !== baseMajor) {
      logger.fail(
        `Version hint ${pkg.version} names ${hinted}, a MAJOR jump past the ` +
          `last released version ${base} — a major requires the explicit ` +
          `--release-as major signal, not a hint.`,
      )
      process.exitCode = 1
      return
    }
    // The hint must advance PAST the last released version — a hint naming an
    // already-published, or lower, version would re-publish or move backward.
    if (!gt(hinted, base)) {
      logger.fail(
        `Version hint ${pkg.version} names ${hinted}, which is not ahead of the ` +
          `last released version ${base} — it would re-publish or move backward. ` +
          `Name a version greater than ${base}.`,
      )
      process.exitCode = 1
      return
    }
    hintedVersion = hinted
    level = 'patch'
    logger.log(
      `Version hint found: ${pkg.version} → releasing as ${hinted} ` +
        `(hint overrides the commit-type heuristic).`,
    )
  } else {
    level = bumpLevelFor(commits)
    // MAJOR is never derived: it is a human decision, made either by the
    // user naming it to an agent (hook-gated `--release-as major`) or by a
    // human selecting it on the release workflow's dispatch form. Breaking
    // commits without that explicit signal stop the release here, loud.
    if (level === 'major') {
      logger.fail(
        `Breaking commit(s) found since ${describeAnchor(anchor)} — ` +
          `a MAJOR bump requires an explicit human decision. Re-run with ` +
          `--release-as major (agent runs need the user's typed authorization; ` +
          `CI needs the release-as=major dispatch input), or --release-as ` +
          `minor|patch if the breaking marker is wrong.`,
      )
      process.exitCode = 1
      return
    }
    // `patch-only` repos (socket-wheelhouse pins 1.0.x) ship commit-derived
    // features as a patch — the change lands, the minor digit does not move.
    // Releasing a minor is deliberate: set a `X.Y.Z-prerelease` hint or pass
    // --release-as minor. A breaking (major) already stopped above.
    if (versionPolicy === 'patch-only' && level === 'minor') {
      logger.log(
        `release.versionPolicy: patch-only — shipping feature commit(s) as a ` +
          `patch (set a X.Y.Z-prerelease hint to release a minor).`,
      )
      level = 'patch'
    }
  }
  let nextVersion: string
  if (hintedVersion) {
    nextVersion = hintedVersion
  } else if (level) {
    nextVersion = computeNextVersion(base, level)
  } else {
    logger.fail(
      `No user-visible commits since ${describeAnchor(anchor)} — ` +
        `nothing to release (feat / fix / perf / breaking only). Land a ` +
        `user-visible change, or pass --release-as <major|minor|patch> to force.`,
    )
    process.exitCode = 1
    return
  }
  const repositoryUrl =
    typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  // ISO date (YYYY-MM-DD). bump.mts is a normal node script (not a workflow
  // sandbox), so `new Date()` is available.
  const date = new Date().toISOString().slice(0, 10)

  // Reclaim stale draft sections before deciding anything. A section for a
  // version NEWER than the last release never shipped: it is a draft this bump
  // owns, written then superseded before it published (a re-cut at a different
  // number, a rejected staging entry, a release that stopped at approve).
  //
  // Gauged against the release BASE, not tag presence: plenty of real history
  // predates the tagging convention, and treating every untagged section as a
  // draft would delete shipped entries. Nothing at or below the base is ever
  // touched.
  //
  // Why this matters: leaving drafts behind wedges the release.
  // `changelog-is-commit-derived` wants the entry to carry every commit since
  // the last tag, while a bump that finds an existing section for its target
  // reports "already applied" and writes nothing — so the entry can never be
  // completed and the only way out is hand-editing a script-owned file.
  const reclaimed = dropUnreleasedChangelogSections(existingChangelog, v =>
    gt(v, base),
  )
  if (reclaimed.dropped.length) {
    logger.log(
      `Reclaiming ${reclaimed.dropped.length} unreleased CHANGELOG draft ` +
        `section(s) above ${base}: ${reclaimed.dropped.join(', ')}.`,
    )
    existingChangelog = reclaimed.text
    // A dry-run previews the reclaimed text without touching the file.
    if (!dryRun) {
      writeThroughMirrorLock(changelogPath, existingChangelog)
    }
  }

  // The whole release chain bumps EXACTLY ONCE. When the CHANGELOG already
  // carries the section for nextVersion and package.json already reads it,
  // the bump landed earlier, the release pipeline's bump stage, and this run
  // is a re-entry — the CI --bump leg once re-derived the same 6.2.1 and
  // committed a DUPLICATE changelog section. No-op loudly; a section without
  // the matching manifest version is a broken half-bump and fails instead.
  if (changelogHasVersionSection(existingChangelog, nextVersion)) {
    if (pkg.version === nextVersion) {
      logger.success(
        `Bump already applied: package.json reads ${nextVersion} and ` +
          `CHANGELOG.md already has its section — nothing to write.`,
      )
      return
    }
    if (versionHintFrom(pkg.version) === nextVersion) {
      // The changelog section landed but the version source still carries
      // the release HINT (`X.Y.Z-prerelease`) — a member manifest joined the
      // layout after the section was written, or an earlier run finalized
      // only part of the tree. Complete the bump: finalize the manifest(s)
      // without touching the changelog.
      logger.log(
        `CHANGELOG.md already carries ${nextVersion}; finalizing the ` +
          `manifest hint ${pkg.version} → ${nextVersion}.`,
      )
      let finalized: string[]
      if (multi) {
        const written = await applyLockstepBump(layout, nextVersion)
        if (!written) {
          process.exitCode = 1
          return
        }
        finalized = written
      } else {
        writeThroughMirrorLock(
          path.join(rootPath, 'package.json'),
          replaceVersion(pkgRaw, nextVersion),
        )
        finalized = ['package.json']
      }
      const addFinalize = await runCapture(
        'git',
        ['add', ...finalized],
        rootPath,
      )
      if (addFinalize.code !== 0) {
        logger.fail('git add failed.')
        process.exitCode = 1
        return
      }
      const commitFinalize = await runCapture(
        'git',
        [
          'commit',
          '-o',
          ...finalized,
          '-m',
          `chore: bump version to ${nextVersion}`,
        ],
        rootPath,
      )
      if (commitFinalize.code !== 0) {
        logger.fail('git commit failed:')
        logger.fail(commitFinalize.stdout)
        process.exitCode = 1
        return
      }
      logger.success(
        `Finalized ${finalized.join(' + ')} at ${nextVersion}. Push, then ` +
          `trigger the publish workflow (stage), then ` +
          `\`node scripts/fleet/npm-publish.mts --approve\` to promote.`,
      )
      return
    }
    logger.fail(
      `CHANGELOG.md already has a ${nextVersion} section but package.json ` +
        `reads ${pkg.version} — a half-applied bump.\n` +
        `  Fix: reconcile the manifest with the changelog (or remove the ` +
        `stale section), then re-run.`,
    )
    process.exitCode = 1
    return
  }
  const versionHeading = changelogHeading(
    nextVersion,
    date,
    repoBaseUrl(repositoryUrl),
  )

  // The release section is the UNION of both bullet sources: the
  // commit-derived bullets and the hand-written `## [Unreleased]` bullets —
  // squash-time accrual plus notes for work whose commits are typed invisible
  // to derivation. Preferring one source over the other dropped hand content
  // (the sdk 4.0.2 incident); composeReleaseSection merges them under their
  // matching headings, dedupes exact duplicates, and empties [Unreleased].
  const {
    baseChangelog,
    promotedUnreleased,
    section: composedSection,
  } = composeReleaseSection({
    changelog: existingChangelog,
    commits,
    date,
    repoUrl: repoBaseUrl(repositoryUrl),
    version: nextVersion,
    versionHeading,
  })
  let section = composedSection

  // A release documents a user-visible change. An entry-less section (only
  // internal/chore commits, or a squash that collapsed the history) is a loud
  // stop, not a silent bare heading — remedy it, or opt into the canned entry.
  if (!sectionHasEntries(section)) {
    if (typeof emptyChangelogEntry === 'string' && emptyChangelogEntry.trim()) {
      section = withChangelogEntry(section, emptyChangelogEntry.trim())
      logger.warn(
        `No user-visible changes derived for ${nextVersion} — recording the ` +
          `supplied entry: "${emptyChangelogEntry.trim()}".`,
      )
    } else {
      logger.fail(
        [
          `[bump] the CHANGELOG for ${nextVersion} has no user-visible entries.`,
          '',
          '  Every release documents a user-visible change; this one derived',
          '  none (only internal/chore commits, or a squash collapsed the',
          '  history). Remedy one of:',
          '',
          `  • add the user-visible changes under "${UNRELEASED_HEADING}" in`,
          '    CHANGELOG.md, then re-run; or',
          '  • re-run with --empty-changelog-entry "<what changed>" to record',
          '    that one line for this release.',
        ].join('\n'),
      )
      process.exitCode = 1
      return
    }
  }

  logger.log(
    `${pkg.name ?? 'package'}: ${pkg.version} → ${nextVersion} ` +
      `(${levelLabel ?? `${level}${releaseAs ? ' — forced via --release-as' : ''}`}; ` +
      `${commits.length} commit(s) since ${describeAnchor(anchor)}` +
      `${promotedUnreleased ? ' + promoted [Unreleased]' : ''})`,
  )
  logger.log('')
  logger.log(section)
  logger.log('')

  if (dryRun) {
    logger.success(
      'Dry-run: no files written. Re-run without --dry-run to bump.',
    )
    return
  }

  let bumpedManifests: string[]
  if (multi) {
    const written = await applyLockstepBump(layout, nextVersion)
    if (!written) {
      process.exitCode = 1
      return
    }
    bumpedManifests = written
  } else {
    writeThroughMirrorLock(
      path.join(rootPath, 'package.json'),
      replaceVersion(pkgRaw, nextVersion),
    )
    bumpedManifests = ['package.json']
  }
  writeThroughMirrorLock(
    changelogPath,
    insertChangelogSection(baseChangelog, section),
  )

  if (writeOnly) {
    logger.success(
      `Wrote ${bumpedManifests.join(' + ')} + CHANGELOG.md for ` +
        `${nextVersion} (--write-only: no commit). The provenance workflow ` +
        `commits these via the GitHub API.`,
    )
    return
  }

  const add = await runCapture(
    'git',
    ['add', ...bumpedManifests, 'CHANGELOG.md'],
    rootPath,
  )
  if (add.code !== 0) {
    logger.fail('git add failed.')
    process.exitCode = 1
    return
  }
  const commit = await runCapture(
    'git',
    [
      'commit',
      '-o',
      ...bumpedManifests,
      'CHANGELOG.md',
      '-m',
      `chore: bump version to ${nextVersion}`,
    ],
    rootPath,
  )
  if (commit.code !== 0) {
    logger.fail('git commit failed:')
    logger.fail(commit.stdout)
    process.exitCode = 1
    return
  }
  logger.success(
    `Bumped to ${nextVersion}. Push, then trigger the publish workflow ` +
      `(stage), then \`node scripts/fleet/npm-publish.mts --approve\` to promote.`,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'derive the next version from the conventional commits since the last release, write package.json + CHANGELOG.md, and commit the bump',
  help: BUMP_USAGE,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
