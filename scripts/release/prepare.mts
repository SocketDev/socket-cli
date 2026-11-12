#!/usr/bin/env node
/**
 * @file Prepares the next version and changelog from landed commits. A separate
 *   job commits these files and opens the PR without running installed code
 *   alongside the release App token.
 *
 *   Usage:
 *     node scripts/release/prepare.mts [--dry-run] [--release-as major|minor|patch]
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  changelogHeading,
  generateChangelogSection,
  promoteChangelog,
  repoBaseUrl,
} from './changelog.mts'
import {
  readReleaseCommits,
  readReleaseHistory,
  readTaggedPrereleaseVersions,
} from './history.mts'
import { readPublishedVersion, readPublishedVersions } from './registry.mts'
import {
  deriveNextVersion,
  maxPrereleaseVersion,
  maxReleaseVersion,
  nextPrereleaseVersion,
  parseConventionalCommits,
  releaseVersionsForLine,
} from './version.mts'
import { readReleasePolicy } from '../../src/sea/version.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

import type { ScriptMeta } from '../lib/run-main.mts'

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
  process.stdout.write(`[prepare] ${message}\n`)
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
      '[prepare] could not rewrite the package.json version field.\n' +
        '  Where: the root package.json, during release preparation.\n' +
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
  const releaseMajorValue = process.env['SOCKET_CLI_RELEASE_MAJOR']
  const releaseMajor = releaseMajorValue
    ? Number.parseInt(releaseMajorValue, 10)
    : undefined
  if (
    releaseMajorValue &&
    (releaseMajor === undefined ||
      !Number.isInteger(releaseMajor) ||
      releaseMajor < 1 ||
      String(releaseMajor) !== releaseMajorValue)
  ) {
    throw new Error(
      `SOCKET_CLI_RELEASE_MAJOR must be a positive integer; received ${releaseMajorValue}`,
    )
  }
  const manifest = readPackageJson()
  const releasePolicy = readReleasePolicy(rootPath)
  const manifestVersion = manifest.parsed.version ?? '0.0.0'
  const selectedReleaseMajor =
    releaseMajor ?? Number(manifestVersion.split('.')[0])
  const prereleaseTrack =
    releasePolicy.mode === 'prerelease-only' &&
    selectedReleaseMajor === Number(releasePolicy.versionHint.split('.')[0])
      ? releasePolicy
      : undefined
  const [publishedVersion, publishedVersions, taggedPrereleases] =
    await Promise.all([
      manifest.parsed.name
        ? readPublishedVersion(manifest.parsed.name)
        : undefined,
      manifest.parsed.name
        ? readPublishedVersions(manifest.parsed.name)
        : Promise.resolve([]),
      prereleaseTrack
        ? readTaggedPrereleaseVersions(
            rootPath,
            prereleaseTrack.versionHint,
            prereleaseTrack.identifier,
          )
        : Promise.resolve([]),
    ])
  const trackPublishedVersion = prereleaseTrack
    ? maxPrereleaseVersion(
        publishedVersions,
        `${prereleaseTrack.versionHint}-${prereleaseTrack.identifier}.`,
      )
    : undefined
  const stableLineBaseline = maxReleaseVersion(
    releaseVersionsForLine(
      publishedVersions,
      manifestVersion,
      prereleaseTrack ? 1 : selectedReleaseMajor,
    ),
  )
  const latestStableBaseline = prereleaseTrack
    ? maxReleaseVersion(publishedVersions)
    : undefined
  const changelogBaseline =
    trackPublishedVersion ?? stableLineBaseline ?? latestStableBaseline
  if (publishedVersions.length > 0 && !changelogBaseline) {
    throw new Error(
      `[prepare] npm has published versions, but none can anchor the ${selectedReleaseMajor}.x changelog. Refusing to use all history.`,
    )
  }
  const history = await readReleaseHistory(
    rootPath,
    manifestVersion,
    releaseMajor,
    changelogBaseline,
  )
  log(
    `npm latest ${publishedVersion ?? '(none)'}; ` +
      `${history.tagVersions.length} landed release tag(s); ` +
      `${history.reservedVersions.length} reserved tag(s); ` +
      `manifest ${manifestVersion}; release major ${releaseMajor ?? 'from manifest'}.`,
  )
  const commitsRaw = await readReleaseCommits(rootPath, history.anchorRef)
  const commits = parseConventionalCommits(commitsRaw)
  const stableDerived = deriveNextVersion({
    commits,
    manifestVersion,
    releaseMajor,
    publishedVersion,
    releaseAs,
    reservedVersions: history.reservedVersions,
    tagVersions: history.tagVersions,
  })
  const derived = prereleaseTrack
    ? {
        ...stableDerived,
        version: nextPrereleaseVersion(prereleaseTrack, [
          manifestVersion,
          ...publishedVersions,
          ...taggedPrereleases,
        ]),
        reason: `prerelease-only policy (${prereleaseTrack.identifier})`,
      }
    : stableDerived
  if (!prereleaseTrack && derived.level === 'major' && !releaseAs) {
    throw new Error(
      `[prepare] a breaking change is in the release range, so the level is major.\n` +
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

  writeFileSync(
    path.join(rootPath, 'package.json'),
    writeManifestVersion(manifest.raw, derived.version),
  )
  writeFileSync(changelogPath, promoted.changelog)
  log(`wrote ${derived.version} to package.json and CHANGELOG.md.`)
  emitOutputs({ version: derived.version })
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'prepares the next release version and changelog from landed commits',
  help: `Usage: node scripts/release/prepare.mts [flags]

  --dry-run                       derive and print the version without writing
                                  package.json or CHANGELOG.md
  --release-as major|minor|patch  force the bump level instead of deriving it
                                  from the conventional commits

  SOCKET_CLI_RELEASE_MAJOR        select a release major when it differs from
                                  the root package version

  The publish-npm workflow runs this in its release-pr mode. It only edits
  the working tree, so a local run is safe to inspect and discard.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
