#!/usr/bin/env node
/**
 * @file The CI bump stage. Derives the next version from the commits landed
 *   since the last release, writes package.json + CHANGELOG.md, and commits the
 *   pair via the release App onto a throwaway `npm-publish-v<version>` branch.
 *
 *   Nothing here is hand-run. The npm-publish workflow calls it between install
 *   and build, so the tarballs it packs carry the derived version and the commit
 *   they claim to be built from. `promote.mts` lands or deletes the branch once
 *   the run is decided.
 *
 *   Usage:
 *     node scripts/release/bump.mts [--dry-run] [--release-as major|minor|patch]
 */

import { execFile as execFileCallback } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  changelogHeading,
  generateChangelogSection,
  promoteChangelog,
  repoBaseUrl,
} from './changelog.mts'
import { commitViaGithubApi } from './github-api.mts'
import {
  discardReleaseBranch,
  openReleaseBranch,
  resolveReleaseEnv,
} from './release-branch.mts'
import {
  COMMIT_LOG_FORMAT,
  deriveNextVersion,
  parseConventionalCommits,
} from './version.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

import type { ReleaseBranch } from './release-branch.mts'
import type { ScriptMeta } from '../lib/run-main.mts'

const execFile = promisify(execFileCallback)

const rootPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

const REGISTRY_URL = 'https://registry.npmjs.org'

interface PackageJsonShape {
  name?: string | undefined
  repository?: { url?: string | undefined } | string | undefined
  version?: string | undefined
}

function log(message: string): void {
  process.stdout.write(`[bump] ${message}\n`)
}

async function git(args: readonly string[]): Promise<string> {
  const { stdout } = await execFile('git', [...args], {
    cwd: rootPath,
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

/**
 * The version npm currently serves as `latest`, or undefined when the package
 * has never been published. A registry read rather than `npm view`: this runs
 * inside a Socket Firewall shimmed environment where the package managers are
 * wrapped, and a plain fetch stays out of that path.
 */
async function fetchPublishedVersion(
  name: string | undefined,
): Promise<string | undefined> {
  if (!name) {
    return undefined
  }
  const response = await fetch(`${REGISTRY_URL}/${name.replace('/', '%2f')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 404) {
    return undefined
  }
  if (!response.ok) {
    throw new Error(
      `[bump] could not read ${name} from the npm registry.\n` +
        `  Where: ${REGISTRY_URL}/${name}, the bump's published-version anchor.\n` +
        `  Saw: HTTP ${response.status}; wanted the packument so the base version is known.\n` +
        `  Fix: re-run once the registry is reachable — deriving without it would skip a version.`,
    )
  }
  const packument = (await response.json()) as {
    'dist-tags'?: { latest?: string | undefined } | undefined
  }
  return packument['dist-tags']?.latest
}

/**
 * The `v<semver>` tags REACHABLE from HEAD, which is what makes this line's
 * history the authority. socket-cli carries the 1.x maintenance line and the 2.x
 * line in one repository, so an unfiltered `git tag --list` on v1.x resolves to
 * a 2.x tag and the release lands on the wrong line.
 *
 * The workflow fetches tags explicitly: a tagless shallow clone would hide a
 * burned version and the bump would re-derive a number that is already spent.
 */
async function readReleaseTags(): Promise<string[]> {
  const stdout = await git(['tag', '--merged', 'HEAD', '--list', 'v*'])
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

/**
 * The conventional commits between the last release and HEAD. Anchors on the
 * `v<base>` tag when it is an ancestor, else the nearest ancestor tag; with no
 * tag at all the whole history is the range, which only happens on a first
 * release.
 */
async function readCommitsSince(base: string): Promise<string> {
  let anchor = ''
  const baseTag = `v${base}`
  try {
    await git(['merge-base', '--is-ancestor', baseTag, 'HEAD'])
    anchor = baseTag
  } catch {
    try {
      anchor = (
        await git(['describe', '--tags', '--abbrev=0', '--match', 'v*'])
      ).trim()
    } catch {
      anchor = ''
    }
  }
  const range = anchor ? `${anchor}..HEAD` : 'HEAD'
  log(`reading commits over ${range}.`)
  return await git(['log', range, `--format=${COMMIT_LOG_FORMAT}`])
}

function readPackageJson(): { parsed: PackageJsonShape; raw: string } {
  const raw = readFileSync(path.join(rootPath, 'package.json'), 'utf8')
  return { parsed: JSON.parse(raw) as PackageJsonShape, raw }
}

/**
 * Rewrite only the manifest's own top-level `version` field, leaving every other
 * byte — key order, indentation, trailing newline — untouched, so the bump diff
 * is the one line a reviewer expects.
 */
export function writeManifestVersion(raw: string, version: string): string {
  const replaced = raw.replace(
    /^(\s*"version":\s*")[^"]*(")/m,
    `$1${version}$2`,
  )
  if (replaced === raw) {
    throw new Error(
      '[bump] could not rewrite the package.json version field.\n' +
        '  Where: the root package.json, at bump time.\n' +
        '  Saw: no top-level `"version": "…"` line; wanted exactly one to replace.\n' +
        '  Fix: restore the version field, then re-dispatch.',
    )
  }
  return replaced
}

function emitOutputs(outputs: Record<string, string>): void {
  const outputPath = process.env['GITHUB_OUTPUT']
  if (!outputPath) {
    return
  }
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`)
  appendFileSync(outputPath, `${lines.join('\n')}\n`)
}

function parseArgs(argv: readonly string[]): {
  dryRun: boolean
  releaseAs: string | undefined
} {
  let releaseAs: string | undefined
  const dryRun = argv.includes('--dry-run')
  const index = argv.indexOf('--release-as')
  if (index !== -1) {
    releaseAs = argv[index + 1]
  }
  return { dryRun, releaseAs }
}

async function main(): Promise<void> {
  const { dryRun, releaseAs } = parseArgs(process.argv.slice(2))
  const manifest = readPackageJson()
  const manifestVersion = manifest.parsed.version ?? '0.0.0'
  const [publishedVersion, tagVersions] = await Promise.all([
    fetchPublishedVersion(manifest.parsed.name),
    readReleaseTags(),
  ])
  log(
    `npm latest ${publishedVersion ?? '(none)'}; ` +
      `${tagVersions.length} release tag(s); manifest ${manifestVersion}.`,
  )
  const commitsRaw = await readCommitsSince(
    // Resolve the base once with an empty commit set so the log range and the
    // final derivation anchor on the same version.
    deriveNextVersion({
      commits: [],
      manifestVersion,
      publishedVersion,
      tagVersions,
    }).base,
  )
  const commits = parseConventionalCommits(commitsRaw)
  const derived = deriveNextVersion({
    commits,
    manifestVersion,
    publishedVersion,
    releaseAs,
    tagVersions,
  })
  if (derived.level === 'major' && !releaseAs) {
    throw new Error(
      `[bump] a breaking change is in the release range, so the level is major.\n` +
        `  Where: the commits between v${derived.base} and HEAD.\n` +
        `  Saw: a derived MAJOR bump; wanted a human to name it — a major is never derived.\n` +
        `  Fix: re-dispatch with release-as set to major to confirm, or minor/patch to override.`,
    )
  }
  log(`${derived.base} → ${derived.version} (${derived.reason}).`)

  const repoUrl = repoBaseUrl(
    typeof manifest.parsed.repository === 'string'
      ? manifest.parsed.repository
      : manifest.parsed.repository?.url,
  )
  const heading = changelogHeading(
    derived.version,
    new Date().toISOString().slice(0, 10),
    repoUrl,
  )
  const changelogPath = path.join(rootPath, 'CHANGELOG.md')
  const promoted = promoteChangelog({
    changelog: readFileSync(changelogPath, 'utf8'),
    derivedSection: generateChangelogSection({ commits, heading }),
    heading,
  })
  log(`changelog section taken from the ${promoted.source} entries.`)

  if (dryRun) {
    log(`dry run — would release ${derived.version}. Nothing written.`)
    process.stdout.write(`${promoted.section}\n`)
    emitOutputs({ version: derived.version })
    return
  }

  const env = resolveReleaseEnv()
  writeFileSync(
    path.join(rootPath, 'package.json'),
    writeManifestVersion(manifest.raw, derived.version),
  )
  writeFileSync(changelogPath, promoted.changelog)

  const parentSha = (await git(['rev-parse', 'HEAD'])).trim()
  const baseTreeSha = (await git(['rev-parse', 'HEAD^{tree}'])).trim()
  const files = ['CHANGELOG.md', 'package.json'].map(relPath => ({
    content: readFileSync(path.join(rootPath, relPath), 'utf8'),
    path: relPath,
  }))
  const releaseBranch: ReleaseBranch = await openReleaseBranch({
    env,
    parentSha,
    version: derived.version,
  })
  // Past this point any failure must nuke the branch, otherwise a leftover
  // npm-publish-v<version> accumulates. The release line is never touched here,
  // so the no-version-creep invariant holds either way.
  try {
    const sha = await commitViaGithubApi({
      baseTreeSha,
      branch: releaseBranch.branch,
      files,
      message: `chore(release): ${derived.version}`,
      parentSha,
      repo: env.repo,
      token: env.token,
    })
    // The checkout runs with persist-credentials off, so the fetch carries the
    // App token inline rather than writing it into .git/config.
    const auth = Buffer.from(`x-access-token:${env.token}`).toString('base64')
    await git([
      '-c',
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`,
      'fetch',
      '--no-tags',
      'origin',
      `refs/heads/${releaseBranch.branch}`,
    ])
    await git(['reset', '--hard', sha])
    log(
      `${derived.version} committed ${sha.slice(0, 7)} on ${releaseBranch.branch} ` +
        'via the release App.',
    )
    emitOutputs({
      'release-branch': releaseBranch.branch,
      sha,
      version: derived.version,
    })
  } catch (e) {
    await discardReleaseBranch(releaseBranch)
    throw e
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'derives the next release version from the landed commits and commits package.json + CHANGELOG.md via the release App',
  help: `Usage: node scripts/release/bump.mts [flags]

  --dry-run                       derive and print the version without opening
                                  a release branch or committing anything
  --release-as major|minor|patch  force the bump level instead of deriving it
                                  from the conventional commits

  The npm-publish workflow runs this between install and build. It is not a
  hand-run script: it needs RELEASE_APP_TOKEN and the GitHub Actions
  environment to reach the release App.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
