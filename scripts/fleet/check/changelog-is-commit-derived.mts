/**
 * @file Guard against a CHANGELOG entry that drifts from the commits it claims
 *   to release — the failure mode that shipped a 6.0.9 entry describing `feat`
 *   work that landed AFTER the 6.0.9 tag. A release CHANGELOG must be DERIVED
 *   from the Conventional Commits being released (run `node
 *   scripts/fleet/bump.mts`), never hand-written ahead of the tag. Fires only
 *   for a PENDING release — when `package.json` version is ahead of the last
 *   `v<semver>` tag. For that pending version it regenerates the entry from the
 *   commits since the last tag and fails when the committed entry's bullets
 *   don't match. A published version (version == last tag) is historical and
 *   not re-validated. Fail-open: any uncertainty (no tag, shallow clone,
 *   unreadable CHANGELOG) skips rather than false-fails. Usage: node
 *   scripts/fleet/check/changelog-is-commit-derived.mts.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { lastReleaseTag, readCommitStream } from '../bump.mts'
import {
  generateChangelogSection,
  parseConventionalCommits,
  repoBaseUrl,
} from '../lib/changelog.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

interface PackageJsonShape {
  repository?: { url?: string | undefined } | string | undefined
  version?: string | undefined
}

const VERSION_HEADING_RE = /^## \[?v?(?<version>\d+\.\d+\.\d+)/

/**
 * The first `## …` version section of the CHANGELOG (heading through the line
 * before the next `## `), or `undefined` when the file has no version sections.
 */
export function topChangelogSection(changelog: string): string | undefined {
  const lines = changelog.split('\n')
  const start = lines.findIndex(l => l.startsWith('## '))
  if (start === -1) {
    return undefined
  }
  let end = lines.length
  for (let i = start + 1, { length } = lines; i < length; i += 1) {
    if (lines[i]!.startsWith('## ')) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n').trim()
}

/**
 * The version in a `## [X.Y.Z]…` / `## vX.Y.Z …` heading, or `undefined`.
 */
export function headingVersion(section: string): string | undefined {
  const m = VERSION_HEADING_RE.exec(section.split('\n')[0] ?? '')
  return m?.groups?.['version']
}

/**
 * The trimmed `- …` bullet lines in a section, as a normalized set.
 */
export function bulletSet(section: string): Set<string> {
  const out = new Set<string>()
  const lines = section.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trimEnd()
    if (line.startsWith('- ')) {
      out.add(line.trim())
    }
  }
  return out
}

async function main(): Promise<void> {
  const pkgPath = path.join(REPO_ROOT, 'package.json')
  const changelogPath = path.join(REPO_ROOT, 'CHANGELOG.md')
  if (!existsSync(pkgPath) || !existsSync(changelogPath)) {
    return
  }
  let pkg: PackageJsonShape
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJsonShape
  } catch {
    return
  }
  const version = pkg.version
  if (!version) {
    return
  }

  const tag = await lastReleaseTag()
  // No tag → first release; nothing to compare against. Published version
  // (tag === v<version>) → historical, not re-validated.
  if (!tag || tag === `v${version}`) {
    return
  }

  const changelog = readFileSync(changelogPath, 'utf8')
  const section = topChangelogSection(changelog)
  if (!section) {
    return
  }

  // The top CHANGELOG section must be the pending version. A mismatch means the
  // bump touched package.json without a matching CHANGELOG entry (or vice versa).
  const topVersion = headingVersion(section)
  if (topVersion !== version) {
    fail(
      `package.json is at ${version} (ahead of tag ${tag}) but the top CHANGELOG ` +
        `section is for ${topVersion ?? 'an unparseable heading'}. Run ` +
        `\`node scripts/fleet/bump.mts\` to generate the ${version} entry — don't hand-edit it.`,
    )
    return
  }

  const commits = parseConventionalCommits(await readCommitStream(tag))
  if (commits.length === 0) {
    // No history to derive from (shallow clone) — fail-open.
    return
  }
  const repositoryUrl =
    typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  const expected = generateChangelogSection({
    commits,
    // Date is excluded from the comparison (bullets only), so any value is fine.
    date: '0000-00-00',
    repoUrl: repoBaseUrl(repositoryUrl),
    version,
  })

  const have = bulletSet(section)
  const want = bulletSet(expected)
  const extra = [...have].filter(b => !want.has(b))
  const missing = [...want].filter(b => !have.has(b))
  if (extra.length === 0 && missing.length === 0) {
    return
  }

  const detail: string[] = []
  if (extra.length) {
    detail.push(
      `  ${extra.length} entry(ies) not derived from a released commit (drift):`,
    )
    for (const b of extra.slice(0, 5)) {
      detail.push(`    + ${b}`)
    }
  }
  if (missing.length) {
    detail.push(
      `  ${missing.length} released commit(s) missing from the entry:`,
    )
    for (const b of missing.slice(0, 5)) {
      detail.push(`    - ${b}`)
    }
  }
  fail(
    `The ${version} CHANGELOG entry doesn't match the commits since ${tag}.\n` +
      `${detail.join('\n')}\n` +
      `  Regenerate it: \`node scripts/fleet/bump.mts\` (the CHANGELOG is derived, not hand-written).`,
  )
}

function fail(message: string): void {
  logger.fail(`changelog-is-commit-derived: ${message}`)
  process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    // Fail-open: a crash in the check must not block an otherwise-valid push.
    process.exitCode = 0
  })
}
