#!/usr/bin/env node
/*
 * @file Assertion: every version this repo PUBLISHED to npm also has its
 *   `v<version>` git tag on origin AND a published GitHub release. The publish
 *   is irreversible; the tag + release are the only public markers that a
 *   version shipped, and they are cut in a second leg AFTER the promote. When
 *   that leg produces nothing, the release is half-done and nothing else in the
 *   fleet notices — a promoted version sat tagless and release-less with no
 *   signal at all until someone happened to look.
 *
 *   Scope — the RELEASE ERA, not all history, and anchored by TIME rather than
 *   by version membership. The anchor is the timestamp of the repo's oldest
 *   published GitHub release; every npm version published at-or-after it must
 *   have both markers. Time is the right axis because the tagged versions and
 *   the published versions need not be the same set: decmpfs carried GitHub
 *   releases for v0.1.1 + v0.1.2, never on npm, beside npm 0.0.0 (a placeholder,
 *   never released) and npm 0.1.3, the gap — a membership anchor finds no
 *   overlap and passes vacuously, while the timestamp anchor exempts the old
 *   placeholder and catches 0.1.3. A repo with no GitHub release has not started
 *   the discipline and asserts nothing, vacuous pass, stated out loud.
 *   Prereleases are out of scope — they are not tagged or released by the
 *   publish tail.
 *
 *   Data: one packument read (versions + their publish timestamps), one
 *   `git ls-remote --tags origin`, one `gh release list`. Fail-OPEN on every
 *   unreachable source, offline lane, no gh auth, no origin — an unreadable
 *   source is un-checkable, not a violation. Release-tier (network) via
 *   `releaseStep` in `_shared/check-steps-release.mts`.
 *
 *   Exit codes: 0 — every in-era published version has its tag + release (or
 *   nothing is checkable); 1 — a release gap, reported with the shared
 *   four-part message naming the exact reconcile command.
 *
 *   Usage: node scripts/fleet/check/published-versions-have-releases.mts [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { fetchRegistryReleaseState } from '../publish-infra/npm/registry.mts'
import { resolveNpmWorkspaceLayout } from '../publish-infra/npm/workspace.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { formatReleaseGapFailure } from '../_shared/release-gap-recovery.mts'

const logger = getDefaultLogger()

// The GitHub release page lists at most this many releases per read — well past
// any fleet repo's history, and one request rather than a paging loop.
const RELEASE_LIST_LIMIT = 500

// A `git ls-remote --tags` line: `<sha>\trefs/tags/<name>`. The `^{}` peel lines
// name the same tag, so the capture deliberately stops before it.
const REMOTE_TAG_REF_RE = /\brefs\/tags\/(\S+?)(?:\^\{\})?$/

export interface PublishedRelease {
  publishedAt: string
  version: string
}

export interface ReleaseGap {
  hasRelease: boolean
  hasTag: boolean
  publishedAt: string
  version: string
}

export interface GithubRelease {
  publishedAt: string
  tagName: string
}

export interface ReleaseGapReport {
  // The oldest published GitHub release — the release era's anchor — or
  // undefined when the repo has never published one.
  era: GithubRelease | undefined
  gaps: ReleaseGap[]
}

/**
 * Split a `git ls-remote --tags origin` payload into the tag names origin
 * carries. Peel refs (`<tag>^{}`) collapse onto their tag. Pure.
 */
export function parseRemoteTagNames(stdout: string): Set<string> {
  const names = new Set<string>()
  const lines = stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const match = REMOTE_TAG_REF_RE.exec(lines[i]!.trim())
    if (match) {
      names.add(match[1]!)
    }
  }
  return names
}

/**
 * Split a `gh release list --json tagName,isDraft,publishedAt` payload into the
 * PUBLISHED, undrafted, dated, releases, oldest first. A draft is invisible to
 * everyone but the maintainers, so it neither anchors the era nor closes a gap.
 * Returns an empty list on malformed input. Pure.
 */
export function parseGithubReleases(json: string): GithubRelease[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) {
    return []
  }
  const releases: GithubRelease[] = []
  for (let i = 0, { length } = parsed; i < length; i += 1) {
    const entry = parsed[i] as
      | {
          isDraft?: boolean | undefined
          publishedAt?: string | undefined
          tagName?: string | undefined
        }
      | undefined
    if (entry?.tagName && entry.publishedAt && entry.isDraft !== true) {
      releases.push({ publishedAt: entry.publishedAt, tagName: entry.tagName })
    }
  }
  return releases.toSorted((a, b) => a.publishedAt.localeCompare(b.publishedAt))
}

/**
 * Pair each published version with its packument publish timestamp, dropping
 * prereleases, never tagged by the publish tail, and any version the `time` map
 * does not date. Sorted oldest-first so the tag era can be anchored by real
 * publish order rather than semver sort (a backfilled version publishes out of
 * semver order). Pure.
 */
export function collectPublishedReleases(config: {
  timeMap: Readonly<Record<string, string>>
  versions: readonly string[]
}): PublishedRelease[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const dated: PublishedRelease[] = []
  for (let i = 0, { length } = cfg.versions; i < length; i += 1) {
    const version = cfg.versions[i]!
    if (version.includes('-')) {
      continue
    }
    const publishedAt = cfg.timeMap[version]
    if (publishedAt) {
      dated.push({ publishedAt, version })
    }
  }
  return dated.toSorted((a, b) => a.publishedAt.localeCompare(b.publishedAt))
}

/**
 * The release gaps over the RELEASE ERA: anchor at the oldest published GitHub
 * release, then report every npm version published at-or-after that moment
 * whose origin tag or published GitHub release is missing. No published GitHub
 * release anywhere means the discipline never started here, so nothing is
 * asserted (`era: undefined`) — never a false green dressed as a pass, the
 * caller says so out loud. Pure — the whole verdict is driven by the three
 * collections.
 */
export function findReleaseGaps(config: {
  published: readonly PublishedRelease[]
  releases: readonly GithubRelease[]
  remoteTags: ReadonlySet<string>
}): ReleaseGapReport {
  const cfg = { __proto__: null, ...config } as typeof config
  const era = cfg.releases.reduce<GithubRelease | undefined>(
    (oldest, release) =>
      oldest && oldest.publishedAt <= release.publishedAt ? oldest : release,
    undefined,
  )
  if (!era) {
    return { era: undefined, gaps: [] }
  }
  const releaseTags = new Set(cfg.releases.map(release => release.tagName))
  const gaps: ReleaseGap[] = []
  for (let i = 0, { length } = cfg.published; i < length; i += 1) {
    const entry = cfg.published[i]!
    if (entry.publishedAt < era.publishedAt) {
      continue
    }
    const tag = `v${entry.version}`
    const hasTag = cfg.remoteTags.has(tag)
    const hasRelease = releaseTags.has(tag)
    if (!hasTag || !hasRelease) {
      gaps.push({
        hasRelease,
        hasTag,
        publishedAt: entry.publishedAt,
        version: entry.version,
      })
    }
  }
  return { era, gaps }
}

/**
 * The operator-facing report for one gap: what is actually missing, then the
 * shared four-part release-gap message with the exact reconcile command. Pure.
 */
export function formatReleaseGapReport(config: {
  gap: ReleaseGap
  name: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const { gap } = cfg
  const missing: string[] = []
  if (!gap.hasTag) {
    missing.push(`no v${gap.version} tag on origin`)
  }
  if (!gap.hasRelease) {
    missing.push(`no published GitHub release for v${gap.version}`)
  }
  return formatReleaseGapFailure({
    name: cfg.name,
    registry: 'npm',
    saw: `${missing.join(' and ')} (published ${gap.publishedAt})`,
    version: gap.version,
    where:
      'check/published-versions-have-releases.mts, over the registry + origin + gh reads',
  })
}

/**
 * Run a read-only command, returning its stdout or undefined when the command
 * is unavailable / exits non-zero, an unreachable source is un-checkable.
 */
export async function readCommandStdout(
  cmd: string,
  args: string[],
): Promise<string | undefined> {
  try {
    const r = (await spawn(cmd, args, {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string | undefined }
    return String(r?.stdout ?? '')
  } catch {
    return undefined
  }
}

export async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  // The WORKSPACE publish subject, not the root manifest. A multi-package repo
  // keeps a private placeholder root while the loader member is what ships, so
  // reading the root reports "private — nothing to assert" and blesses a real
  // gap (decmpfs 0.1.3 sat untagged behind exactly that read).
  let name = ''
  try {
    name = resolveNpmWorkspaceLayout(REPO_ROOT).versionSource.name
  } catch {
    name = ''
  }
  if (!name) {
    if (!quiet) {
      logger.log(
        'published-versions-have-releases: no publishable package here — nothing to assert.',
      )
    }
    return
  }
  const state = await fetchRegistryReleaseState(name)
  if (!state) {
    logger.log(
      `published-versions-have-releases: skipped — could not read the ${name} packument (offline lane?).`,
    )
    return
  }
  const published = collectPublishedReleases({
    timeMap: state.timeMap,
    versions: state.versions,
  })
  if (published.length === 0) {
    if (!quiet) {
      logger.log(
        `published-versions-have-releases: ${name} has no dated stable release yet — nothing to assert.`,
      )
    }
    return
  }
  const remoteStdout = await readCommandStdout('git', [
    'ls-remote',
    '--tags',
    'origin',
  ])
  if (remoteStdout === undefined) {
    logger.log(
      'published-versions-have-releases: skipped — origin tags unreadable (no remote / offline lane).',
    )
    return
  }
  const releaseStdout = await readCommandStdout('gh', [
    'release',
    'list',
    '--limit',
    String(RELEASE_LIST_LIMIT),
    '--json',
    'tagName,isDraft,publishedAt',
  ])
  if (releaseStdout === undefined) {
    logger.log(
      'published-versions-have-releases: skipped — gh release list unreadable (gh missing / unauthenticated).',
    )
    return
  }
  const report = findReleaseGaps({
    published,
    releases: parseGithubReleases(releaseStdout),
    remoteTags: parseRemoteTagNames(remoteStdout),
  })
  if (!report.era) {
    logger.log(
      `published-versions-have-releases: ${name} has no published GitHub release — the release discipline has not started here, nothing asserted.`,
    )
    return
  }
  if (report.gaps.length === 0) {
    if (!quiet) {
      logger.success(
        `published-versions-have-releases: every ${name} version published since ${report.era.tagName} (${report.era.publishedAt}) has its tag + GitHub release.`,
      )
    }
    return
  }
  logger.error(
    `[published-versions-have-releases] ${report.gaps.length} published version(s) with no tag + GitHub release:`,
  )
  for (let i = 0, { length } = report.gaps; i < length; i += 1) {
    logger.error(formatReleaseGapReport({ gap: report.gaps[i]!, name }))
  }
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'check that every published npm version has its tag and GitHub release',
  help: `Usage: node scripts/fleet/check/published-versions-have-releases.mts [flags]
  --quiet   suppress the success line`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
