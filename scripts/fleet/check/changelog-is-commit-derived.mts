/**
 * @file Guard against a CHANGELOG entry that LOSES the commits it claims to
 *   release — the failure mode that shipped a 6.0.9 entry describing `feat`
 *   work that landed AFTER the 6.0.9 tag. A release CHANGELOG's derived side
 *   must be DERIVED from the Conventional Commits being released (run `node
 *   scripts/fleet/bump.mts`). Fires only for a PENDING release — when
 *   `package.json` version is ahead of the last `v<semver>` tag. For that
 *   pending version it regenerates the entry via bump.mts's OWN
 *   `deriveReleaseCommits` — the same base + anchor chain + commit stream the
 *   generator used, one implementation for both sides — and asserts every
 *   commit-derived bullet is PRESENT in the section and the anchor/range is
 *   correct. Hand-written EXTRAS are tolerated: hand content is human-owned,
 *   accrues under `## [Unreleased]`, and the bump promotes it into the
 *   release section (the sdk 4.0.2 cached-scan bullets were dropped by a
 *   stricter exact-match rule). A present `[Unreleased]` section is never a
 *   finding. A published version (version == last tag) is historical and not
 *   re-validated. Fail-open: any uncertainty (no tag, shallow clone,
 *   unreachable registry, unresolvable range anchor, unreadable CHANGELOG)
 *   skips rather than false-fails. Usage: node
 *   scripts/fleet/check/changelog-is-commit-derived.mts.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { deriveReleaseCommits } from '../bump.mts'
import {
  generateChangelogSection,
  repoBaseUrl,
  versionHintFrom,
} from '../lib/changelog.mts'
import { describeAnchor, lastReleaseTag } from '../lib/release-anchor.mts'
import { REPO_ROOT } from '../paths.mts'
import { runCapture } from '../publish-infra/shared.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

interface PackageJsonShape {
  name?: string | undefined
  repository?: { url?: string | undefined } | string | undefined
  version?: string | undefined
}

const VERSION_HEADING_RE = /^## \[?v?(?<version>\d+\.\d+\.\d+)/

// The `## [Unreleased]` / `## Unreleased` heading — hand-written notes accrue
// there between releases and the bump promotes them, so its presence is never
// a finding: the top-section probe skips past it.
const UNRELEASED_HEADING_RE = /^##\s+\[?unreleased\]?\s*$/i

/**
 * The first `## …` version section of the CHANGELOG (heading through the line
 * before the next `## `), skipping an `## [Unreleased]` block, or `undefined`
 * when the file has no version sections.
 */
export function topChangelogSection(changelog: string): string | undefined {
  const lines = changelog.split('\n')
  const start = lines.findIndex(
    l => l.startsWith('## ') && !UNRELEASED_HEADING_RE.test(l.trim()),
  )
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
 * True when a `v<version>` tag EXISTS by name, reachable or not. The fleet
 * squash/consolidation model rewrites main under released tags, so
 * `git describe` (reachability) can resolve an OLDER tag while the version's
 * own tag exists off-lineage — an existing tag means the version is released
 * and its CHANGELOG entry is historical, not pending.
 */
export async function releaseTagExists(version: string): Promise<boolean> {
  const r = await runCapture('git', ['tag', '-l', `v${version}`], REPO_ROOT)
  return r.code === 0 && r.stdout.trim() === `v${version}`
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

/**
 * The commit-derived bullets of `expected` that are ABSENT from the committed
 * `section` — the check's one red condition. Extras in `section` beyond the
 * derived set are tolerated by construction: hand-written bullets are
 * human-owned — they accrue under `## [Unreleased]` and the bump promotes
 * them into the release section — so a hand SUPERSET of the derived bullets
 * is a healthy section, never drift. Losing derived content stays red.
 */
export function missingDerivedBullets(
  section: string,
  expected: string,
): string[] {
  const have = bulletSet(section)
  return [...bulletSet(expected)].filter(b => !have.has(b))
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
  // (tag === v<version>, or the v<version> tag exists off-lineage after a
  // history consolidation) → historical, not re-validated.
  if (!tag || tag === `v${version}` || (await releaseTagExists(version))) {
    return
  }

  const changelog = readFileSync(changelogPath, 'utf8')
  const section = topChangelogSection(changelog)
  if (!section) {
    return
  }

  // ONE derivation, shared byte-for-byte with bump.mts's generation (same
  // base, same anchor chain, same commit stream). `undefined` means a prior
  // release exists but no anchor resolves, or the registry is unreachable —
  // fail-open, never regenerate from a widened (older-tag) range that would
  // flag shipped entries as drift.
  const derivation = await deriveReleaseCommits({
    manifestVersion: version,
    packageName: pkg.name,
  })
  if (!derivation) {
    return
  }

  // A `-prerelease` hint version means the CHANGELOG entry for the hinted
  // release doesn't exist yet — the release run's bump.mts generates it. Until
  // then the top section must remain the last RELEASED version (registry
  // latest + tag — NOT `git describe`, which resolves an older tag when the
  // newest release's tag is missing); a section already carrying the hinted
  // version is stale or hand-authored.
  const topVersion = headingVersion(section)
  const hinted = versionHintFrom(version)
  if (hinted) {
    if (topVersion !== derivation.base) {
      fail(
        `package.json carries release hint ${version} (next release: ${hinted}) ` +
          `but the top CHANGELOG section is for ${topVersion ?? 'an unparseable heading'}. ` +
          `The release run's bump.mts generates the ${hinted} entry — restore ` +
          `CHANGELOG.md to its ${derivation.base} state and don't hand-edit it.`,
      )
    }
    return
  }

  // The top CHANGELOG section must be the pending version. A mismatch means the
  // bump touched package.json without a matching CHANGELOG entry (or vice versa).
  if (topVersion !== version) {
    fail(
      `package.json is at ${version} (ahead of tag ${tag}) but the top CHANGELOG ` +
        `section is for ${topVersion ?? 'an unparseable heading'}. Run ` +
        `\`node scripts/fleet/bump.mts\` to generate the ${version} entry — don't hand-edit it.`,
    )
    return
  }

  const { commits } = derivation
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

  // Hand-written bullets beyond the derived set are TOLERATED — hand content
  // is human-owned; it accrues under `## [Unreleased]` and the bump promotes
  // it into the release section. Only LOSING derived content is red.
  const missing = missingDerivedBullets(section, expected)
  if (missing.length === 0) {
    return
  }

  const detail: string[] = [
    `  ${missing.length} released commit(s) missing from the entry:`,
  ]
  const bs = missing.slice(0, 5)
  for (let i = 0, { length } = bs; i < length; i += 1) {
    const b = bs[i]!
    detail.push(`    - ${b}`)
  }
  fail(
    `The ${version} CHANGELOG entry is missing commit-derived bullet(s) for ` +
      `the commits since ${describeAnchor(derivation.anchor)}.\n` +
      `${detail.join('\n')}\n` +
      `  Regenerate it: \`node scripts/fleet/bump.mts\` unions the ` +
      `commit-derived bullets with the hand-written "## [Unreleased]" notes.\n` +
      `  Hand-written extras are fine and stay; author new hand notes under ` +
      `"## [Unreleased]" so the next bump promotes them — never delete a ` +
      `derived bullet.`,
  )
}

function fail(message: string): void {
  logger.fail(`changelog-is-commit-derived: ${message}`)
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    // Fail-open: a crash in the check must not block an otherwise-valid push.
    process.exitCode = 0
  })
}
