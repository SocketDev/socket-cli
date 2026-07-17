/**
 * @file Version-bump orchestration for the cargo-publish CI path: derive the
 *   next version + CHANGELOG section from the Conventional Commits since the
 *   last release tag (the registry-agnostic lib/changelog.mts helpers, the same
 *   ones scripts/fleet/bump.mts uses), write the version into Cargo.toml
 *   (`[workspace.package]` if present, else `[package]`) with a table-scoped
 *   replace that never touches dependency versions, prepend the CHANGELOG
 *   section, then commit the changed files (Cargo.toml, CHANGELOG.md, and
 *   Cargo.lock if it changed) via the GitHub git-objects API for a signed
 *   commit without a local GPG key. No dist/ rebuild step (unlike npm) — cargo
 *   builds from source at publish time.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  bumpLevelFor,
  changelogHeading,
  COMMIT_LOG_FORMAT,
  computeNextVersion,
  generateChangelogSection,
  parseConventionalCommits,
  promoteUnreleased,
  repoBaseUrl,
  sectionHasEntries,
} from '../../lib/changelog.mts'
import { commitViaGithubApi } from '../../lib/commit-via-github-api.mts'
import { logger, rootPath, runCapture } from '../shared.mts'
import { readCargoPackage } from './shared.mts'

import type { BumpLevel } from '../../lib/changelog.mts'

/**
 * Resolve the most recent `v<semver>` release tag, or undefined for a repo with
 * no release tags yet (first release — all history is the changelog). Mirrors
 * scripts/fleet/bump.mts.
 */
export async function lastReleaseTag(): Promise<string | undefined> {
  const r = await runCapture(
    'git',
    ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'],
    rootPath,
  )
  const tag = r.stdout.trim()
  return r.code === 0 && tag ? tag : undefined
}

/**
 * Read the commit stream between `fromTag` (exclusive) and HEAD in the
 * parseable COMMIT_LOG_FORMAT. With no prior tag, reads all history.
 */
export async function readCommitStream(
  fromTag: string | undefined,
): Promise<string> {
  const range = fromTag ? `${fromTag}..HEAD` : 'HEAD'
  const r = await runCapture(
    'git',
    ['log', range, `--format=${COMMIT_LOG_FORMAT}`],
    rootPath,
  )
  return r.code === 0 ? r.stdout : ''
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
 * github.token). Resets the checkout to the new commit so the publish runs
 * against the bumped tree. Dry-run previews and writes/commits nothing. Unlike
 * npm there is no dist/ rebuild — cargo builds from source at publish time.
 */
export async function runBump(options: {
  dryRun: boolean
  packageName?: string | undefined
  releaseAs?: string | undefined
}): Promise<void> {
  const opts = { __proto__: null, ...options } as {
    dryRun: boolean
    packageName?: string | undefined
    releaseAs?: string | undefined
  }
  const { dryRun, releaseAs } = opts
  const pkg = await readCargoPackage(opts.packageName)

  const fromTag = await lastReleaseTag()
  const commits = parseConventionalCommits(await readCommitStream(fromTag))
  // Version resolution: the --release-as flag wins, else the commit-type
  // heuristic. MAJOR is never derived — it needs the explicit --release-as
  // major signal (agent runs are hook-gated on the user's typed authorization;
  // CI on the dispatch input).
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
  } else {
    level = bumpLevelFor(commits)
    if (level === 'major') {
      logger.fail(
        `Breaking commit(s) found since ${fromTag ?? 'the start of history'} — ` +
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
      `No user-visible commits since ${fromTag ?? 'the start of history'} — ` +
        'nothing to release (feat / fix / perf / revert only). Land a ' +
        'user-visible change, or pass --release-as <major|minor|patch> to force.',
    )
    process.exitCode = 1
    return
  }

  const nextVersion = computeNextVersion(pkg.version, level)
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
      `${promoted ? 'from [Unreleased]' : `${commits.length} commit(s) since ${fromTag ?? 'start'}`})`,
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
  const repo = process.env['GITHUB_REPOSITORY']
  const branch = process.env['GITHUB_REF_NAME']
  // The in-house release App token (minted by the workflow's app-token action),
  // NOT the default github.token — least-privilege + verified/app-attributed.
  const token =
    process.env['RELEASE_APP_TOKEN'] || process.env['GH_TOKEN'] || ''
  if (!repo || !branch || !token) {
    throw new Error(
      '[cargo bump] needs GITHUB_REPOSITORY, GITHUB_REF_NAME, and a release App ' +
        'token (RELEASE_APP_TOKEN / GH_TOKEN) in the environment.',
    )
  }
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
  const sha = await commitViaGithubApi({
    baseTreeSha: baseTree.stdout.trim(),
    branch,
    files: commitFiles,
    message: `chore: bump version to ${nextVersion}`,
    parentSha: parent.stdout.trim(),
    repo,
    token,
  })
  await runCapture('git', ['fetch', 'origin', branch], rootPath)
  await runCapture('git', ['reset', '--hard', sha], rootPath)
  logger.success(
    `[cargo bump] ${nextVersion} committed ${sha.slice(0, 7)} via the release App.`,
  )
}
