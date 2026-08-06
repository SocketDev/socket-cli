/*
 * @file The CHANGELOG section primitives the bump step composes with: locating,
 *   listing, removing, and inserting a version's section, promoting
 *   [Unreleased], and the version-string rewrite in a manifest.
 *
 *   Split out of bump.mts, which was past the 1000-line hard cap. These are
 *   pure string transforms over CHANGELOG text — no filesystem, no git — which
 *   is why they carry the bulk of the step's existing test coverage.
 *
 *   Section boundaries come from a parsed GFM tree (lib/markdown-ast.mts), not
 *   from `line.startsWith('## ')`: a changelog that documents its own markup in
 *   a fenced block used to split there, so the entries after the fence were
 *   filed under a phantom version and dropped by the next remove/extract. Edits
 *   are still applied as slices of the ORIGINAL text at the parser's line
 *   positions — nothing is re-serialized, so untouched bytes never churn.
 */

import {
  changelogHeading,
  generateChangelogSection,
  promoteUnreleased,
  unionSections,
} from '../lib/changelog.mts'
import { documentHeadings, headingLines } from '../lib/markdown-ast.mts'

import type { ConventionalCommit } from '../lib/changelog.mts'
import type { MarkdownHeading } from '../lib/markdown-ast.mts'

// The version a `## ` heading names, read from the heading's TEXT: an optional
// `[` (link-style heading whose label is the version) and an optional `v`, then
// three dot-separated numbers plus an optional `-prerelease` tail. Anchored, so
// only a heading's own version matches.
const HEADING_VERSION_RE = /^\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/

/**
 * The document's `## ` headings, newest first — the section boundaries every
 * helper here slices on.
 */
function versionHeadings(changelog: string): MarkdownHeading[] {
  return documentHeadings(changelog).filter(heading => heading.depth === 2)
}

/**
 * True when a `## ` heading's text names exactly `version`. Matches the heading
 * shapes seen across the fleet — `1.2.3`, `[1.2.3]`, `v1.2.3`, each optionally
 * followed by a date — and requires the version to END there, so a 6.2.1 probe
 * cannot match a 6.2.10 heading.
 */
function headingNamesVersion(text: string, version: string): boolean {
  const rest = text.trim().replace(/^\[/, '').replace(/^v/, '')
  return rest.startsWith(version) && !/^[0-9.]/.test(rest.slice(version.length))
}

/**
 * The `[start, end)` line range of `version`'s section — its heading through
 * the line before the next `## ` heading, or EOF — plus that heading's text, or
 * undefined when the changelog has no section for `version`. One range finder,
 * shared by remove + extract so they can never disagree on a boundary.
 */
function versionSectionRange(
  changelog: string,
  version: string,
): { end: number; headingText: string; start: number } | undefined {
  const headings = versionHeadings(changelog)
  const at = headings.findIndex(heading =>
    headingNamesVersion(heading.text, version),
  )
  if (at === -1) {
    return undefined
  }
  const next = headings[at + 1]
  return {
    end: next ? next.line : changelog.split('\n').length,
    headingText: headings[at]!.text,
    start: headings[at]!.line,
  }
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
  return versionHeadings(changelog).some(heading =>
    headingNamesVersion(heading.text, version),
  )
}

/**
 * Every `## <version>` heading in `changelog`, newest first. `[Unreleased]` and
 * any non-version heading are skipped — only real version sections are listed.
 */
export function changelogVersionSections(changelog: string): string[] {
  const found: string[] = []
  for (const heading of versionHeadings(changelog)) {
    const version = HEADING_VERSION_RE.exec(heading.text)?.[1]
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
  const range = versionSectionRange(changelog, version)
  if (!range) {
    return changelog
  }
  const lines = changelog.split('\n')
  return [...lines.slice(0, range.start), ...lines.slice(range.end)].join('\n')
}

/**
 * Extract an existing `## [<version>]` section: its body, the changelog with
 * the section removed, and the date its heading carried (so a recompose
 * preserves the original release date instead of restamping today). Returns
 * undefined when the changelog has no section for `version`. Pure over its
 * inputs — the same heading matcher removeChangelogVersionSection uses.
 */
export function extractVersionSection(
  changelog: string,
  version: string,
):
  | { changelog: string; date: string | undefined; section: string }
  | undefined {
  const range = versionSectionRange(changelog, version)
  if (!range) {
    return undefined
  }
  const lines = changelog.split('\n')
  const date = /-\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(range.headingText)?.[1]
  return {
    changelog: [...lines.slice(0, range.start), ...lines.slice(range.end)].join(
      '\n',
    ),
    date,
    section: lines.slice(range.start, range.end).join('\n').trimEnd(),
  }
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
  const sectionHeading = versionHeadings(section)[0]
  const sectionVersion = sectionHeading
    ? HEADING_VERSION_RE.exec(sectionHeading.text)?.[1]
    : undefined
  if (
    sectionVersion !== undefined &&
    changelogHasVersionSection(existing, sectionVersion)
  ) {
    return existing
  }
  const lines = existing.split('\n')
  const firstHeading = headingLines(existing, 2)[0] ?? -1
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
  // An existing `## [<version>]` section is a third source, same standing as
  // the [Unreleased] accrual: absorbed into the union (its date preserved on
  // the heading) instead of ignored or duplicated. A hand-titled section that
  // accrued before the bump — or a bump re-entered after a partial run — then
  // merges with the derived entries rather than freezing them out.
  const existing = extractVersionSection(changelog, version)
  const heading =
    existing?.date !== undefined
      ? changelogHeading(version, existing.date, repoUrl)
      : versionHeading
  const withoutExisting = existing?.changelog ?? changelog
  const derivedSection =
    heading === versionHeading
      ? derived
      : generateChangelogSection({ commits, date, heading, repoUrl, version })
  let section = derivedSection
  if (existing) {
    section = unionSections(heading, section, existing.section)
  }
  const promoted = promoteUnreleased(withoutExisting, heading)
  if (!promoted) {
    return {
      baseChangelog: withoutExisting,
      promotedUnreleased: false,
      section,
    }
  }
  return {
    baseChangelog: promoted.changelog,
    promotedUnreleased: true,
    section: unionSections(heading, section, promoted.section),
  }
}

// Commit types the changelog derivation never maps to a section — work
// committed under them is invisible to the derived CHANGELOG. `docs` and the
// other internal types are deliberately narrower than "everything unmapped":
// the warning below targets the types that have historically smuggled
// user-facing src/ work past derivation.
