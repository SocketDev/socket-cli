#!/usr/bin/env node
/**
 * @file The CI bump stage. Derives the next version from the commits landed
 *   since the last release, writes package.json + CHANGELOG.md, and commits the
 *   pair via the release App onto a throwaway `npm-publish-v<version>` branch.
 *
 *   Nothing here is hand-run. The publish-npm workflow calls it between install
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
import { readReleaseCommits, readReleaseHistory } from './history.mts'
import { readPublishedVersion } from './registry.mts'
import {
  discardReleaseBranch,
  openReleaseBranch,
  resolveReleaseEnv,
} from './release-branch.mts'
import { deriveNextVersion, parseConventionalCommits } from './version.mts'
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

const VERSION_FIELD_PATTERN = /("version":\s*")[^"]+(")/

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
  // Test for the field before replacing: a manifest already sitting on
  // `version` rewrites to itself, and comparing output to input cannot tell
  // that no-op apart from a missing field.
  if (!VERSION_FIELD_PATTERN.test(raw)) {
    throw new Error(
      '[bump] could not rewrite the package.json version field.\n' +
        '  Where: the root package.json, at bump time.\n' +
        '  Saw: no top-level `"version": "…"` line; wanted exactly one to replace.\n' +
        '  Fix: restore the version field, then re-dispatch.',
    )
  }
  return raw.replace(
    VERSION_FIELD_PATTERN,
    (_m, pre: string, post: string) => `${pre}${version}${post}`,
  )
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
  const [publishedVersion, history] = await Promise.all([
    manifest.parsed.name
      ? readPublishedVersion(manifest.parsed.name)
      : undefined,
    readReleaseHistory(rootPath, manifestVersion),
  ])
  log(
    `npm latest ${publishedVersion ?? '(none)'}; ` +
      `${history.tagVersions.length} landed release tag(s); ` +
      `${history.reservedVersions.length} reserved tag(s); manifest ${manifestVersion}.`,
  )
  const commitsRaw = await readReleaseCommits(rootPath, history.anchorTag)
  const commits = parseConventionalCommits(commitsRaw)
  const derived = deriveNextVersion({
    commits,
    manifestVersion,
    publishedVersion,
    releaseAs,
    reservedVersions: history.reservedVersions,
    tagVersions: history.tagVersions,
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

  The publish-npm workflow runs this between install and build. It is not a
  hand-run script: it needs RELEASE_APP_TOKEN and the GitHub Actions
  environment to reach the release App.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
