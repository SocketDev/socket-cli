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

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { gt } from '@socketsecurity/lib-stable/versions/compare'

import {
  bumpLevelFor,
  changelogHeading,
  computeNextVersion,
  generateChangelogSection,
  promoteUnreleased,
  repoBaseUrl,
  sectionHasEntries,
  unionSections,
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
import {
  checkVersionLockstep,
  planLockstepManifestWrites,
} from './publish-infra/npm/workspace-plan.mts'
import { resolveNpmWorkspaceLayout } from './publish-infra/npm/workspace.mts'
import { runCapture, runInherit } from './publish-infra/shared.mts'

import type { NpmWorkspaceLayout } from './publish-infra/npm/workspace.mts'

import type { BumpLevel, ConventionalCommit } from './lib/changelog.mts'
import type { ReleaseDerivation, ReleaseLane } from './lib/release-anchor.mts'
import { isMainModule } from './_shared/is-main-module.mts'

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

/**
 * Replace the root `"version"` field in package.json text, preserving the
 * file's existing formatting (a JSON.parse → stringify round-trip would reorder
 * keys and reflow the file). Matches the first `"version"` — the root field.
 */
export function replaceVersion(raw: string, nextVersion: string): string {
  return raw.replace(
    /("version":\s*")[^"]+(")/,
    (_m, pre: string, post: string) => `${pre}${nextVersion}${post}`,
  )
}

/**
 * True when the CHANGELOG already carries a section heading for `version`.
 * Matches the heading shapes seen across the fleet — `## 1.2.3`,
 * `## [1.2.3](url)`, `## v1.2.3`, each optionally followed by a date — and
 * requires the version to end there (a 6.2.1 probe must not match a 6.2.10
 * heading).
 */
export function changelogHasVersionSection(
  changelog: string,
  version: string,
): boolean {
  return changelog.split('\n').some(line => {
    if (!line.startsWith('## ')) {
      return false
    }
    const rest = line.slice(3).trim().replace(/^\[/, '').replace(/^v/, '')
    return (
      rest.startsWith(version) && !/^[0-9.]/.test(rest.slice(version.length))
    )
  })
}

/**
 * Every `## <version>` heading in `changelog`, newest first. `[Unreleased]` and
 * any non-version heading are skipped — only real version sections are listed.
 */
export function changelogVersionSections(changelog: string): string[] {
  const found: string[] = []
  const lines = changelog.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line.startsWith('## ')) {
      continue
    }
    // `## ` then an optional `[`, link-style heading, and optional `v`, then
    // the captured version: three dot-separated numbers plus an optional
    // `-prerelease` tail. Anchored, so only a heading's own version matches.
    const version = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(
      line,
    )?.[1]
    if (version) {
      found.push(version)
    }
  }
  return found
}

/**
 * `changelog` with the section for `version` removed (heading through the line
 * before the next `## ` heading, or EOF). Returns the input unchanged when no
 * such section exists.
 */
export function removeChangelogVersionSection(
  changelog: string,
  version: string,
): string {
  const lines = changelog.split('\n')
  const start = lines.findIndex(line => {
    if (!line.startsWith('## ')) {
      return false
    }
    const rest = line.slice(3).trim().replace(/^\[/, '').replace(/^v/, '')
    return (
      rest.startsWith(version) && !/^[0-9.]/.test(rest.slice(version.length))
    )
  })
  if (start === -1) {
    return changelog
  }
  let end = lines.length
  for (let i = start + 1, { length } = lines; i < length; i += 1) {
    if (lines[i]!.startsWith('## ')) {
      end = i
      break
    }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n')
}

/**
 * Drop every version section the release never actually shipped.
 *
 * A section is a DRAFT when its version is newer than the last release: it was
 * written, then superseded before it ever published (a re-cut at a different
 * number, a rejected staging entry, a release that stopped at approve).
 *
 * `isDraft` is injected so the pruning stays pure. Callers pass a
 * base-relative predicate (`v => gt(v, base)`) rather than a tag lookup:
 * plenty of real history predates the tagging convention, so treating every
 * untagged section as a draft would delete shipped entries.
 */
export function dropUnreleasedChangelogSections(
  changelog: string,
  isDraft: (version: string) => boolean,
): { dropped: string[]; text: string } {
  const dropped: string[] = []
  let text = changelog
  for (const version of changelogVersionSections(changelog)) {
    if (isDraft(version)) {
      dropped.push(version)
      text = removeChangelogVersionSection(text, version)
    }
  }
  return { dropped, text }
}

/**
 * Insert a new CHANGELOG section above the first existing `## ` version heading
 * after the file's intro. When the file has no version sections yet, append
 * after a trailing blank line. IDEMPOTENT per version: when the changelog
 * already carries a section for the version the new section names, the input
 * is returned unchanged — a re-entrant bump (the release pipeline bumps
 * locally, then the dispatched npm-publish.yml --bump ran again in CI) once
 * inserted a duplicate 6.2.1 section and committed it via the release App.
 */
export function insertChangelogSection(
  existing: string,
  section: string,
): string {
  const sectionHeading = section
    .split('\n')
    .find(line => line.startsWith('## '))
  const sectionVersion = sectionHeading
    ? /^##\s+\[?v?(\d+\.\d+\.\d+)/.exec(sectionHeading)?.[1]
    : undefined
  if (
    sectionVersion !== undefined &&
    changelogHasVersionSection(existing, sectionVersion)
  ) {
    return existing
  }
  const lines = existing.split('\n')
  const firstHeading = lines.findIndex(l => l.startsWith('## '))
  if (firstHeading === -1) {
    return `${existing.replace(/\s*$/, '')}\n\n${section}\n`
  }
  const before = lines.slice(0, firstHeading).join('\n').replace(/\s*$/, '')
  const after = lines.slice(firstHeading).join('\n')
  return `${before}\n\n${section}\n\n${after}`
}

/**
 * Compose the release section for `version` from BOTH bullet sources: the
 * commit-derived bullets, the shared anchor-chain derivation, UNIONED with the
 * hand-written bullets accrued under `## [Unreleased]`, merged under their
 * matching Added/Changed/Fixed headings with exact-duplicate lines collapsed.
 * Promotion empties the `[Unreleased]` block from the returned
 * `baseChangelog` — the fleet style creates the heading on demand, so
 * `mergeUnreleased` recreates it at the next squash-time accrual. Preferring
 * one source over the other is the incident shape this replaces: sdk 4.0.2's
 * cached-scan/pollIntervalMs feature shipped UNDOCUMENTED because its bullets
 * were hand-written, its commits chore-typed, and the strict commit-derived
 * regeneration dropped the hand-written side. Pure over its inputs.
 */
export function composeReleaseSection(config: {
  changelog: string
  commits: readonly ConventionalCommit[]
  date: string
  repoUrl: string | undefined
  version: string
  versionHeading: string
}): { baseChangelog: string; promotedUnreleased: boolean; section: string } {
  const { changelog, commits, date, repoUrl, version, versionHeading } = {
    __proto__: null,
    ...config,
  } as {
    changelog: string
    commits: readonly ConventionalCommit[]
    date: string
    repoUrl: string | undefined
    version: string
    versionHeading: string
  }
  const derived = generateChangelogSection({
    commits,
    date,
    heading: versionHeading,
    repoUrl,
    version,
  })
  const promoted = promoteUnreleased(changelog, versionHeading)
  if (!promoted) {
    return {
      baseChangelog: changelog,
      promotedUnreleased: false,
      section: derived,
    }
  }
  return {
    baseChangelog: promoted.changelog,
    promotedUnreleased: true,
    section: unionSections(versionHeading, derived, promoted.section),
  }
}

// Commit types the changelog derivation never maps to a section — work
// committed under them is invisible to the derived CHANGELOG. `docs` and the
// other internal types are deliberately narrower than "everything unmapped":
// the warning below targets the types that have historically smuggled
// user-facing src/ work past derivation.
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
async function collectTouchedFiles(
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
function warnDerivationInvisibleCommits(
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
 * Apply the multi-package LOCKSTEP bump: rewrite every publishable member
 * manifest (+ the versioned root) to `nextVersion` — root `version` field and
 * exact sibling pins (the loader's optionalDependencies rows) together — then
 * invoke each member's own platform-package generator so the generated
 * `npm/<platformId>/` manifests re-derive from the bumped main manifest, and
 * re-verify lockstep afterwards. Returns the written manifest rel-paths, or
 * undefined after failing loud (a non-zero generator or post-generator drift
 * never ships a half-applied bump).
 */
export async function applyLockstepBump(
  layout: NpmWorkspaceLayout,
  nextVersion: string,
): Promise<string[] | undefined> {
  const siblingNames = layout.packages.map(pkg => pkg.name)
  const inputs = layout.packages.map(pkg => ({
    name: pkg.name,
    raw: readFileSync(pkg.manifestPath, 'utf8'),
    relManifestPath: pkg.relManifestPath,
    siblingNames,
  }))
  if (layout.versionSource.relManifestPath === 'package.json') {
    // The root manifest carries the version, the stuie shape — it moves in
    // lockstep too.
    inputs.push({
      name: '',
      raw: readFileSync(path.join(layout.rootPath, 'package.json'), 'utf8'),
      relManifestPath: 'package.json',
      siblingNames,
    })
  }
  const writes = planLockstepManifestWrites(inputs, nextVersion)
  for (const write of writes) {
    writeFileSync(
      path.join(layout.rootPath, write.relManifestPath),
      write.updated,
    )
  }
  // Generated platform dirs re-derive from the bumped main manifest via the
  // repo's OWN generator (make-npm-dirs) — the engine invokes it, never
  // reimplements it.
  const generators = [
    ...new Set(
      layout.packages
        .map(pkg => pkg.generatorPath)
        .filter(generatorPath => generatorPath !== undefined),
    ),
  ]
  for (let i = 0, { length } = generators; i < length; i += 1) {
    const generatorPath = generators[i]!
    logger.log(
      `[bump] regenerating platform packages: node ` +
        `${path.relative(layout.rootPath, generatorPath)}`,
    )
    // eslint-disable-next-line no-await-in-loop -- serial by design: generators rewrite the tree
    const code = await runInherit(
      process.execPath,
      [generatorPath],
      layout.rootPath,
    )
    if (code !== 0) {
      logger.fail(
        `[bump] the platform-package generator exited ${code}.\n` +
          `  Where: ${generatorPath}\n` +
          `  Saw vs wanted: a non-zero generator exit; wanted regenerated ` +
          `npm/<platformId>/ manifests at ${nextVersion}.\n` +
          `  Fix: run it directly and repair the generator — the bump never ` +
          `ships half-regenerated platform dirs.`,
      )
      return undefined
    }
  }
  // The generator derives platform manifests from the bumped main manifest;
  // verify it actually converged — a generator that pins its own version
  // would silently break lockstep here.
  const drift = checkVersionLockstep(resolveNpmWorkspaceLayout(layout.rootPath))
  if (drift.length > 0) {
    logger.fail(
      `[bump] version lockstep is broken AFTER the platform-package ` +
        `generator ran:\n${drift.map(line => `    ${line}`).join('\n')}\n` +
        `  Fix: make the generator derive name/version from its package's ` +
        `own manifest (never a hard-coded version), then re-run.`,
    )
    return undefined
  }
  return writes.map(write => write.relManifestPath)
}

// Every flag `main` accepts. Kept beside the parseArgs options it mirrors so a
// new flag is added in both places, and `unrecognizedFlags` can refuse the rest.
export const BUMP_FLAGS: ReadonlySet<string> = new Set([
  'dry-run',
  'empty-changelog-entry',
  'help',
  'release-as',
  'write-only',
])

export const BUMP_USAGE = `Usage: node scripts/fleet/bump.mts [options]

  Derives the next version from the Conventional Commits since the last
  release, writes package.json + CHANGELOG.md, and commits the bump.

  --dry-run                    preview; writes nothing
  --release-as <level|X.Y.Z>   major | minor | patch, or an exact version
  --write-only                 write the files but do NOT git-commit (CI)
  --empty-changelog-entry <s>  entry to use when no user-visible changes derive
  --help                       print this and exit

  The VERSION is the user's decision. Prefer naming the target as a
  \`X.Y.Z-prerelease\` hint in package.json — the release tooling consumes it.`

/**
 * The `--flag` tokens in `argv` that `known` does not contain, normalized off
 * their leading dashes and any `=value` tail. A bare `-` or `--` is ignored,
 * and everything after a `--` separator is treated as positional.
 */
export function unrecognizedFlags(
  argv: readonly string[],
  known: ReadonlySet<string>,
): string[] {
  const unknown: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const token = argv[i]!
    if (token === '--') {
      break
    }
    if (!token.startsWith('--') || token.length <= 2) {
      continue
    }
    const name = token.slice(2).split('=')[0]!
    if (name && !known.has(name)) {
      unknown.push(`--${name}`)
    }
  }
  return unknown
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { default: false, type: 'boolean' },
      // Operator/UI override for the SemVer level. Default (omitted) derives the
      // level from the Conventional Commits. Use it when the commit types don't
      // capture intent — a breaking change committed without `!`, or a milestone
      // major. A publish-workflow dropdown passes this through. NOT AI: the bump
      // stays deterministic; this is an explicit human decision.
      'release-as': { type: 'string' },
      // CI uses --write-only: write package.json + CHANGELOG but DON'T
      // git-commit. The provenance workflow then commits the changed files via
      // the GitHub git-objects API (web-flow-verified, no GPG key) — main
      // requires signed commits and CI has no signing key, so a plain
      // `git commit` from CI can't land.
      'write-only': { default: false, type: 'boolean' },
      // The entry to record when a release derives no user-visible changes, in
      // place of the loud stop that asks for real entries. Deliberate + named
      // by the operator (e.g. --empty-changelog-entry "Internal maintenance"),
      // never a silent canned default.
      'empty-changelog-entry': { type: 'string' },
      help: { default: false, type: 'boolean' },
    },
    strict: false,
  })
  // `--help` must never mutate. It printed nothing here and, because parsing is
  // non-strict, fell through to a REAL bump — writing package.json, rewriting
  // the CHANGELOG, and committing a version nobody named.
  if (values['help']) {
    logger.log(BUMP_USAGE)
    return
  }
  // Non-strict parsing keeps unknown flags from throwing, which also means a
  // typo silently loses its meaning: `--dryrun` parses as an unknown flag and
  // the run bumps FOR REAL. A mutating script must not guess — refuse instead.
  const unknownFlags = unrecognizedFlags(process.argv.slice(2), BUMP_FLAGS)
  if (unknownFlags.length) {
    logger.fail(
      `bump: unrecognized flag(s) ${unknownFlags.join(', ')}.\n` +
        `  What:  this script WRITES (version + CHANGELOG + commit), so an\n` +
        `         unrecognized flag is refused rather than ignored — a typo'd\n` +
        `         --dry-run would otherwise perform a real bump.\n` +
        `  Where: the bump CLI.\n` +
        `  Saw:   ${unknownFlags.join(', ')}; wanted one of: ${[...BUMP_FLAGS].toSorted().join(', ')}.\n` +
        `  Fix:   correct the flag, or run --help for the full list.`,
    )
    process.exitCode = 1
    return
  }
  const dryRun = !!values['dry-run']
  const releaseAs = values['release-as']
  const writeOnly = !!values['write-only']
  const emptyChangelogEntry = values['empty-changelog-entry']

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
  // Version resolution, most-explicit first: the --release-as flag, then a
  // committed version HINT (package.json version carrying a prerelease
  // suffix, e.g. `6.0.10-prerelease` → release 6.0.10), then the commit-type
  // heuristic. MAJOR is never derived and a hint cannot smuggle one in: a
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
  if (typeof releaseAs === 'string') {
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
  if (!level) {
    logger.fail(
      `No user-visible commits since ${describeAnchor(anchor)} — ` +
        `nothing to release (feat / fix / perf / breaking only). Land a ` +
        `user-visible change, or pass --release-as <major|minor|patch> to force.`,
    )
    process.exitCode = 1
    return
  }

  const nextVersion = hintedVersion ?? computeNextVersion(base, level)
  const repositoryUrl =
    typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  // ISO date (YYYY-MM-DD). bump.mts is a normal node script (not a workflow
  // sandbox), so `new Date()` is available.
  const date = new Date().toISOString().slice(0, 10)
  const changelogPath = path.join(rootPath, 'CHANGELOG.md')
  let existingChangelog = readFileSync(changelogPath, 'utf8')

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
      writeFileSync(changelogPath, existingChangelog)
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
        writeFileSync(
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
      `(${level}${releaseAs ? ' — forced via --release-as' : ''}; ` +
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
    writeFileSync(
      path.join(rootPath, 'package.json'),
      replaceVersion(pkgRaw, nextVersion),
    )
    bumpedManifests = ['package.json']
  }
  writeFileSync(changelogPath, insertChangelogSection(baseChangelog, section))

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

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
