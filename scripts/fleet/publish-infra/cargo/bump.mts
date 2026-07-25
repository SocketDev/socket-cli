/**
 * @file Version-bump orchestration for the cargo-publish CI path: derive the
 *   next version + CHANGELOG section from the Conventional Commits since the
 *   LAST RELEASED version (the shared lib/release-anchor.mts chain bound to
 *   crates.io — tag → Cargo.toml version-flip commit → crates.io publish time,
 *   else stop loud, never widen to an older tag — feeding the registry-agnostic
 *   lib/changelog.mts helpers, the same ones scripts/fleet/bump.mts uses),
 *   write the version into Cargo.toml (`[workspace.package]` if present, else
 *   `[package]`) with a table-scoped replace that never touches dependency
 *   versions, prepend the CHANGELOG section, then commit the changed files
 *   (Cargo.toml, CHANGELOG.md, and Cargo.lock if it changed) via the GitHub
 *   git-objects API for a signed commit without a local GPG key. No dist/
 *   rebuild step (unlike npm) — cargo builds from source at publish time.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { gt } from '@socketsecurity/lib-stable/versions/compare'

import {
  bumpLevelFor,
  changelogHeading,
  computeNextVersion,
  generateChangelogSection,
  promoteUnreleased,
  repoBaseUrl,
  sectionHasEntries,
  versionHintFrom,
} from '../../lib/changelog.mts'
import { commitViaGithubApi } from '../../lib/commit-via-github-api.mts'
import {
  deriveReleaseCommits,
  describeAnchor,
} from '../../lib/release-anchor.mts'
import {
  discardReleaseBranch,
  openReleaseBranch,
  resolveReleaseEnv,
} from '../release-branch.mts'
import { logger, rootPath, runCapture } from '../shared.mts'
import { fetchPublishedAt, fetchPublishedVersionChecked } from './registry.mts'
import { readCargoPackage } from './shared.mts'

import type { BumpLevel } from '../../lib/changelog.mts'
import type {
  ReleaseDerivation,
  ReleaseLane,
} from '../../lib/release-anchor.mts'
import type { BumpResult } from '../release-branch.mts'
import type { CargoPackage } from './shared.mts'

/**
 * The `version = "…"` value scoped to a specific TOML `table`
 * (`workspace.package` or `package`), or undefined when the table or its
 * version line isn't found. The reading twin of `replaceCargoVersion`, with
 * the same table-scoped line scan so a dependency version can never match.
 * Pure — exported for tests.
 */
export function readCargoVersion(
  raw: string,
  table: string,
): string | undefined {
  const lines = raw.split('\n')
  const headerRe = new RegExp(
    `^\\s*\\[\\s*${table.replace(/\./g, '\\.')}\\s*\\]\\s*$`,
  )
  let start = -1
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (headerRe.test(lines[i]!)) {
      start = i
      break
    }
  }
  if (start === -1) {
    return undefined
  }
  for (let i = start + 1, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    // The version must live in THIS table — stop at the next table header.
    if (/^\s*\[/.test(line)) {
      break
    }
    const m = /^\s*version\s*=\s*"([^"]*)"/.exec(line)
    if (m) {
      return m[1]
    }
  }
  return undefined
}

/**
 * A Cargo manifest's release version: `[workspace.package]` version when
 * present (workspace-inherited), else the `[package]` version. Pure —
 * exported for tests.
 */
export function cargoManifestVersion(raw: string): string | undefined {
  return (
    readCargoVersion(raw, 'workspace.package') ??
    readCargoVersion(raw, 'package')
  )
}

/**
 * The repo-relative path of the manifest whose version flip marks a release:
 * the workspace-root Cargo.toml when its `[workspace.package]` carries the
 * version, else the crate's own manifest. Mirrors `runBump`'s write-side
 * preference so the anchor probe reads the same file the bump writes.
 */
export function cargoVersionManifestPath(
  pkg: CargoPackage,
  cwd: string = rootPath,
): string {
  const rootCargoToml = path.join(cwd, 'Cargo.toml')
  if (
    existsSync(rootCargoToml) &&
    readCargoVersion(readFileSync(rootCargoToml, 'utf8'), 'workspace.package')
  ) {
    return 'Cargo.toml'
  }
  return path.relative(cwd, pkg.manifestPath)
}

/**
 * The cargo binding of the shared anchor chain (lib/release-anchor.mts): the
 * version flip lives in Cargo.toml (`[workspace.package]` else `[package]`),
 * the publish ledger is crates.io (`max_stable_version` + per-version
 * `created_at`).
 */
export function cargoReleaseLane(
  pkg: CargoPackage,
  cwd: string = rootPath,
): ReleaseLane {
  return {
    fetchLatest: () => fetchPublishedVersionChecked(pkg.name),
    fetchPublishedAt: version => fetchPublishedAt(pkg.name, version),
    manifestPath: cargoVersionManifestPath(pkg, cwd),
    parseManifestVersion: cargoManifestVersion,
  }
}

/**
 * THE single cargo-lane derivation code path for a release's commit set — the
 * shared chain bound to crates.io. Returns `undefined` when a previous
 * release exists but no anchor resolves, or when crates.io is unreachable
 * (offline the released base cannot be confirmed) — never widen to an older
 * tag.
 */
export async function deriveCargoReleaseCommits(config: {
  cwd?: string | undefined
  pkg: CargoPackage
}): Promise<ReleaseDerivation | undefined> {
  const { cwd = rootPath, pkg } = { __proto__: null, ...config } as {
    cwd?: string | undefined
    pkg: CargoPackage
  }
  return await deriveReleaseCommits({
    cwd,
    lane: cargoReleaseLane(pkg, cwd),
    manifestVersion: pkg.version,
  })
}

/**
 * Replace the `version = "X.Y.Z"` line scoped to a specific TOML `table`
 * (`workspace.package` or `package`) — never a dependency version. Finds the
 * table header, then the first `version = "…"` line before the next table
 * header, and rewrites only that. Returns the new text, or undefined when the
 * table or its version line isn't found (so the caller can try the next table).
 * A dependency version (`foo = { version = "1" }`) never matches: the line must
 * START with `version =`. Pure — exported for tests.
 */
export function replaceCargoVersion(
  raw: string,
  table: string,
  nextVersion: string,
): string | undefined {
  const lines = raw.split('\n')
  const headerRe = new RegExp(
    `^\\s*\\[\\s*${table.replace(/\./g, '\\.')}\\s*\\]\\s*$`,
  )
  let start = -1
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (headerRe.test(lines[i]!)) {
      start = i
      break
    }
  }
  if (start === -1) {
    return undefined
  }
  for (let i = start + 1, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    // The version must live in THIS table — stop at the next table header.
    if (/^\s*\[/.test(line)) {
      break
    }
    // Capture a `version = "X"` line as (indent+key+open-quote)(value)(close-quote+rest).
    const m = /^(\s*version\s*=\s*")([^"]*)(".*)$/.exec(line)
    if (m) {
      lines[i] = `${m[1]}${nextVersion}${m[3]}`
      return lines.join('\n')
    }
  }
  return undefined
}

/**
 * Insert a new CHANGELOG section above the first existing `## ` version heading
 * (after the file's intro). When the file has no version sections yet, append
 * after a trailing blank line. Mirrors scripts/fleet/bump.mts. Pure — exported
 * for tests.
 */
export function insertChangelogSection(
  existing: string,
  section: string,
): string {
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
 * CI bump stage (the workflow runs `cargo-publish.mts --staged --bump`).
 * Derives the next version + CHANGELOG section from the Conventional Commits,
 * writes them into Cargo.toml + CHANGELOG.md (and refreshes Cargo.lock to the
 * new workspace version), then commits the changed files via the GitHub
 * git-objects API so the commit is verified/SIGNED without a GPG key —
 * authenticated with the in-house release APP token (RELEASE_APP_TOKEN /
 * GH_TOKEN, set by the workflow's app-token minter, NOT the default
 * github.token). The commit lands on a throwaway `cargo-publish-v<version>`
 * branch (NOT main): the caller fast-forwards main to it only once the publish
 * succeeds and nukes it on rejection, so a failed publish never creeps the
 * version. Resets the checkout to the new commit so the publish runs against
 * the bumped tree, and returns the branch + tip SHA for the caller to promote /
 * discard. Dry-run previews and writes/commits nothing (returns undefined).
 * Unlike npm there is no dist/ rebuild — cargo builds from source at publish
 * time.
 */
export async function runBump(config: {
  dryRun: boolean
  packageName?: string | undefined
  releaseAs?: string | undefined
}): Promise<BumpResult | undefined> {
  const cfg = { __proto__: null, ...config } as {
    dryRun: boolean
    packageName?: string | undefined
    releaseAs?: string | undefined
  }
  const { dryRun, releaseAs } = cfg
  const pkg = await readCargoPackage(cfg.packageName)

  // ONE derivation resolves the released base (crates.io latest + last tag,
  // NEVER the Cargo.toml version — a pre-bumped manifest would otherwise skip
  // a version), the range anchor, and the commit set — the shared chain that
  // never silently widens to an older tag.
  const derivation = await deriveCargoReleaseCommits({ pkg })
  if (!derivation) {
    logger.fail(
      `Cannot anchor the changelog range: either crates.io is unreachable ` +
        `(offline, the released base cannot be confirmed and \`git describe\` ` +
        `may resolve an OLDER tag), or a previous release exists but its ` +
        `v-tag is missing (or off-lineage), no Cargo.toml version-flip ` +
        `commit for it is reachable, and its crates.io publish time is ` +
        `unavailable. Re-run online, or restore the previous release's tag ` +
        `(git tag v<version> <release-commit> && git push origin --tags) — ` +
        `deriving from an OLDER tag would re-list already-shipped commits.`,
    )
    process.exitCode = 1
    return
  }
  const { anchor, base, commits } = derivation
  // Version resolution: the --release-as flag wins, else a committed
  // `X.Y.Z-prerelease` hint names the exact target, else the commit-type
  // heuristic. MAJOR is never derived — it needs the explicit --release-as
  // major signal (agent runs are hook-gated on the user's typed authorization;
  // CI on the dispatch input).
  const hinted = versionHintFrom(pkg.version)
  let hintedVersion: string | undefined
  let level: BumpLevel | undefined
  if (typeof releaseAs === 'string') {
    if (
      releaseAs !== 'major' &&
      releaseAs !== 'minor' &&
      releaseAs !== 'patch'
    ) {
      logger.fail(
        `--release-as must be one of major | minor | patch (got "${releaseAs}").`,
      )
      process.exitCode = 1
      return
    }
    level = releaseAs
  } else if (hinted) {
    // A `X.Y.Z-prerelease` hint names the exact release target — the human
    // pre-committed the version as a repo artifact instead of leaning on the
    // heuristic. MAJOR can't be smuggled in through a hint (it still needs
    // --release-as major), and the hint must advance PAST the last released
    // base or it would re-publish / move backward.
    // Compare against the last released `base`, not the manifest — `hinted` is
    // the manifest with its suffix stripped, so its major always equals the
    // manifest's; comparing them was dead code that let a `X.0.0-prerelease`
    // hint smuggle a major into a PERMANENT crates.io publish.
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
    if (level === 'major') {
      logger.fail(
        `Breaking commit(s) found since ${describeAnchor(anchor)} — ` +
          'a MAJOR bump requires an explicit human decision. Re-run with ' +
          '--release-as major, or --release-as minor|patch if the breaking ' +
          'marker is wrong.',
      )
      process.exitCode = 1
      return
    }
  }
  if (!level) {
    logger.fail(
      `No user-visible commits since ${describeAnchor(anchor)} — ` +
        'nothing to release (feat / fix / perf / revert only). Land a ' +
        'user-visible change, or pass --release-as <major|minor|patch> to force.',
    )
    process.exitCode = 1
    return
  }

  const nextVersion = hintedVersion ?? computeNextVersion(base, level)
  const repoUrl = repoBaseUrl(pkg.repository)
  const date = new Date().toISOString().slice(0, 10)
  const changelogPath = path.join(rootPath, 'CHANGELOG.md')
  const existingChangelog = existsSync(changelogPath)
    ? readFileSync(changelogPath, 'utf8')
    : ''
  const versionHeading = changelogHeading(nextVersion, date, repoUrl)
  // Prefer the accrued `## [Unreleased]` section (the reliable source in a
  // squash-history repo); fall back to commit-derivation.
  const promoted = existingChangelog
    ? promoteUnreleased(existingChangelog, versionHeading)
    : undefined
  const section = promoted
    ? promoted.section
    : generateChangelogSection({
        commits,
        date,
        repoUrl,
        version: nextVersion,
      })
  const baseChangelog = promoted ? promoted.changelog : existingChangelog
  if (!sectionHasEntries(section)) {
    logger.fail(
      `[cargo bump] the CHANGELOG for ${nextVersion} has no user-visible ` +
        'entries (only internal/chore commits, or a squash collapsed the ' +
        'history). Add the changes under "## [Unreleased]" in CHANGELOG.md, ' +
        'then re-run.',
    )
    process.exitCode = 1
    return
  }

  // Resolve which manifest carries the version + its rewritten text (no write
  // yet — the dry-run gate is below). Prefer the workspace-inherited version
  // (`[workspace.package]` in the workspace-root Cargo.toml); fall back to the
  // crate's own `[package]` version.
  const rootCargoToml = path.join(rootPath, 'Cargo.toml')
  let tomlWrite: { content: string; path: string } | undefined
  if (existsSync(rootCargoToml)) {
    const updated = replaceCargoVersion(
      readFileSync(rootCargoToml, 'utf8'),
      'workspace.package',
      nextVersion,
    )
    if (updated !== undefined) {
      tomlWrite = { content: updated, path: rootCargoToml }
    }
  }
  if (!tomlWrite) {
    const updated = replaceCargoVersion(
      readFileSync(pkg.manifestPath, 'utf8'),
      'package',
      nextVersion,
    )
    if (updated === undefined) {
      logger.fail(
        '[cargo bump] could not find a version line under [workspace.package] ' +
          'or [package] to bump.',
      )
      process.exitCode = 1
      return
    }
    tomlWrite = { content: updated, path: pkg.manifestPath }
  }

  logger.log(
    `${pkg.name}: ${pkg.version} → ${nextVersion} (${level}` +
      `${releaseAs ? ' — forced via --release-as' : ''}; ` +
      `${promoted ? 'from [Unreleased]' : `${commits.length} commit(s) since ${describeAnchor(anchor)}`})`,
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

  writeFileSync(tomlWrite.path, tomlWrite.content)
  writeFileSync(changelogPath, insertChangelogSection(baseChangelog, section))
  // Refresh Cargo.lock to the new workspace-member version (not registry deps),
  // so the later `cargo publish --locked` doesn't fail on a stale lock.
  if (existsSync(path.join(rootPath, 'Cargo.lock'))) {
    const lock = await runCapture('cargo', ['update', '--workspace'], rootPath)
    if (lock.code !== 0) {
      logger.warn(
        `[cargo bump] cargo update --workspace exited ${lock.code}; Cargo.lock ` +
          'may be stale.',
      )
    }
  }

  // Commit exactly the files git reports as changed (Cargo.toml, CHANGELOG.md,
  // and Cargo.lock when it moved).
  const diff = await runCapture('git', ['diff', '--name-only'], rootPath)
  const files = diff.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  if (files.length === 0) {
    logger.log('[cargo bump] no changes from the bump — nothing to commit.')
    return
  }
  const env = resolveReleaseEnv()
  const commitFiles = files.map(p => ({
    content: readFileSync(path.join(rootPath, p), 'utf8'),
    path: p,
  }))
  const parent = await runCapture('git', ['rev-parse', 'HEAD'], rootPath)
  const baseTree = await runCapture(
    'git',
    ['rev-parse', 'HEAD^{tree}'],
    rootPath,
  )
  const parentSha = parent.stdout.trim()
  // Land the bump on a throwaway cargo-publish-v<version> branch, NOT main — the
  // caller fast-forwards main to it only after the publish succeeds, and nukes
  // it on rejection, so a failed publish never creeps the version.
  const releaseBranch = await openReleaseBranch({
    channel: 'cargo',
    env,
    parentSha,
    version: nextVersion,
  })
  // Once the branch exists, any failure below must nuke it — otherwise a leftover
  // <channel>-publish-v<version> branch accumulates (main is never touched, so
  // the version-creep invariant holds regardless).
  try {
    const sha = await commitViaGithubApi({
      baseTreeSha: baseTree.stdout.trim(),
      branch: releaseBranch.branch,
      files: commitFiles,
      message: `chore: bump version to ${nextVersion}`,
      parentSha,
      repo: env.repo,
      token: env.token,
    })
    await runCapture('git', ['fetch', 'origin', releaseBranch.branch], rootPath)
    await runCapture('git', ['reset', '--hard', sha], rootPath)
    logger.success(
      `[cargo bump] ${nextVersion} committed ${sha.slice(0, 7)} on ` +
        `${releaseBranch.branch} via the release App.`,
    )
    return { releaseBranch, sha }
  } catch (e) {
    await discardReleaseBranch(releaseBranch)
    throw e
  }
}
