/*
 * @file The CHANGELOG section primitives the bump step composes with: locating,
 *   listing, removing, and inserting a version's section, promoting
 *   [Unreleased], and the version-string rewrite in a manifest.
 *
 *   Split out of bump.mts, which was past the 1000-line hard cap. These are
 *   pure string transforms over CHANGELOG text — no filesystem, no git — which
 *   is why they carry the bulk of the step's existing test coverage.
 */

import {
  generateChangelogSection,
  promoteUnreleased,
  unionSections,
} from '../lib/changelog.mts'

import type { ConventionalCommit } from '../lib/changelog.mts'

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

