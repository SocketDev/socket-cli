/**
 * @file Release-prep step: derive the next version from the Conventional
 *   Commits since the last release tag, generate the CHANGELOG entry from those
 *   same commits, write `package.json` + `CHANGELOG.md`, and commit `chore:
 *   bump version to X.Y.Z`. The CHANGELOG is DERIVED here, never hand-written,
 *   so it can't drift ahead of the tag (the failure mode that shipped a 6.0.9
 *   entry describing work that landed after the 6.0.9 tag). The tag + GitHub
 *   release are created later, at publish/approve time, by `publish.mts`
 *   (`ensureTagAndRelease`) / the provenance workflow — this step only prepares
 *   the bump commit. Release flow: node scripts/fleet/bump.mts # version +
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

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  bumpLevelFor,
  COMMIT_LOG_FORMAT,
  computeNextVersion,
  generateChangelogSection,
  parseConventionalCommits,
  repoBaseUrl,
  versionHintFrom,
} from './lib/changelog.mts'
import { REPO_ROOT } from './paths.mts'
import { runCapture } from './publish-shared.mts'

import type { BumpLevel } from './lib/changelog.mts'

const logger = getDefaultLogger()
const rootPath = REPO_ROOT

interface PackageJsonShape {
  name?: string | undefined
  repository?: { url?: string | undefined } | string | undefined
  version?: string | undefined
}

/**
 * Resolve the most recent `v<semver>` release tag, or `undefined` for a repo
 * with no release tags yet (first release — all history is the changelog).
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
 * parseable `COMMIT_LOG_FORMAT`. With no prior tag, reads all history.
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
 * Insert a new CHANGELOG section above the first existing `## ` version heading
 * (after the file's intro). When the file has no version sections yet, append
 * after a trailing blank line.
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
    },
    strict: false,
  })
  const dryRun = !!values['dry-run']
  const releaseAs = values['release-as']
  const writeOnly = !!values['write-only']

  const { parsed: pkg, raw: pkgRaw } = readPackageJson()
  if (!pkg.version) {
    logger.fail('package.json has no version field.')
    process.exitCode = 1
    return
  }

  const fromTag = await lastReleaseTag()
  const commits = parseConventionalCommits(await readCommitStream(fromTag))
  // Version resolution, most-explicit first: the --release-as flag, then a
  // committed version HINT (package.json version carrying a prerelease
  // suffix, e.g. `6.0.10-prerelease` → release 6.0.10), then the commit-type
  // heuristic. MAJOR is never derived and a hint cannot smuggle one in: a
  // major jump always needs the explicit flag (agent runs are hook-gated on
  // the user's typed authorization; CI on the dispatch input).
  const hinted = versionHintFrom(pkg.version)
  let level: BumpLevel | undefined
  let hintedVersion: string | undefined
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
    const currentMajor = pkg.version.split('.')[0]
    if (hinted.split('.')[0] !== currentMajor) {
      logger.fail(
        `Version hint ${pkg.version} names a MAJOR jump — a major requires ` +
          `the explicit --release-as major signal, not a hint.`,
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
        `Breaking commit(s) found since ${fromTag ?? 'the start of history'} — ` +
          `a MAJOR bump requires an explicit human decision. Re-run with ` +
          `--release-as major (agent runs need the user's typed authorization; ` +
          `CI needs the release-as=major dispatch input), or --release-as ` +
          `minor|patch if the breaking marker is wrong.`,
      )
      process.exitCode = 1
      return
    }
  }
  if (!level) {
    logger.fail(
      `No user-visible commits since ${fromTag ?? 'the start of history'} — ` +
        `nothing to release (feat / fix / perf / breaking only). Land a ` +
        `user-visible change, or pass --release-as <major|minor|patch> to force.`,
    )
    process.exitCode = 1
    return
  }

  // Honor a `release.versionPolicy: 'patch-only'` declaration in the per-repo
  // .config/socket-wheelhouse.json (socket-wheelhouse pins 1.0.x). A firm gate,
  // not a nudge: to ship a major/minor, change the policy in config — that's
  // the deliberate, reviewable signal, not a per-run flag.
  let versionPolicy: string | undefined
  try {
    const config = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, '.config', 'socket-wheelhouse.json'),
        'utf8',
      ),
    ) as { release?: { versionPolicy?: string | undefined } | undefined }
    versionPolicy = config.release?.versionPolicy
  } catch {
    versionPolicy = undefined
  }
  if (versionPolicy === 'patch-only' && level !== 'patch') {
    logger.fail(
      `${pkg.name ?? 'this repo'} is release.versionPolicy: patch-only ` +
        `(pinned ${pkg.version}) — refusing a ${level} bump. Land the change as ` +
        `a fix/patch, or relax release.versionPolicy in ` +
        `.config/socket-wheelhouse.json to allow major/minor.`,
    )
    process.exitCode = 1
    return
  }

  const nextVersion = hintedVersion ?? computeNextVersion(pkg.version, level)
  const repositoryUrl =
    typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  // ISO date (YYYY-MM-DD). bump.mts is a normal node script (not a workflow
  // sandbox), so `new Date()` is available.
  const date = new Date().toISOString().slice(0, 10)
  const section = generateChangelogSection({
    commits,
    date,
    repoUrl: repoBaseUrl(repositoryUrl),
    version: nextVersion,
  })

  logger.log(
    `${pkg.name ?? 'package'}: ${pkg.version} → ${nextVersion} ` +
      `(${level}${releaseAs ? ' — forced via --release-as' : ' — from commit types'}, ` +
      `${commits.length} commit(s) since ${fromTag ?? 'start'})`,
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

  const changelogPath = path.join(rootPath, 'CHANGELOG.md')
  const existingChangelog = readFileSync(changelogPath, 'utf8')
  writeFileSync(
    path.join(rootPath, 'package.json'),
    replaceVersion(pkgRaw, nextVersion),
  )
  writeFileSync(
    changelogPath,
    insertChangelogSection(existingChangelog, section),
  )

  if (writeOnly) {
    logger.success(
      `Wrote package.json + CHANGELOG.md for ${nextVersion} (--write-only: no ` +
        `commit). The provenance workflow commits these via the GitHub API.`,
    )
    return
  }

  const add = await runCapture(
    'git',
    ['add', 'package.json', 'CHANGELOG.md'],
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
      'package.json',
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
