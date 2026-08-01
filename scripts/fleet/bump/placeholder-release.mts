/**
 * @file The PLACEHOLDER-version release decision. A fleet package that has
 *   never shipped still carries the unreleased placeholder version its
 *   scaffolding wrote — `0.0.0`, or a `X.Y.Z-prerelease` hint such as the
 *   `0.1.0-prerelease` an envrypt-shaped workspace carries. Its first REAL
 *   release is `0.1.0`: not the commit-derived bump, and not `1.0.0`.
 *   Why the derived bump is wrong here: `bump.mts` derives the level from the
 *   Conventional Commits since the last release, and a repo with no last
 *   release derives across ALL of history. A `feat!` in that stream asks for a
 *   major, an all-`fix` stream asks for `0.0.1`, and an all-`chore` stream
 *   asks for nothing at all — three wrong answers for one first cut. The
 *   placeholder state has no released base to bump FROM, so the level
 *   heuristic has nothing to say and the convention answers instead.
 *   Precedent: `@socketsecurity/facts` sat at `0.0.0` and shipped `0.1.0`;
 *   `@socketsecurity/scan-patterns` follows the same path.
 *   The OWNER still names versions — this only moves the DEFAULT. An explicit
 *   `--release-as` always wins, and a named version below `0.1.0` warns loud
 *   and proceeds rather than blocking.
 *   Pure over its inputs: no git, no registry, no filesystem. `bump.mts`
 *   collects the three facts it needs — whether a prior release exists, the
 *   CHANGELOG's version sections, the manifest version — and hands them here.
 */

import { gt } from '@socketsecurity/lib-stable/versions/compare'

import { computeNextVersion, isPrereleaseVersion } from '../lib/changelog.mts'

/**
 * The version a package releases FIRST when it still carries the placeholder.
 */
export const FIRST_RELEASE_VERSION = '0.1.0'

/**
 * A placeholder has released nothing, so every level in that state counts up
 * from zero: `--release-as minor` lands `0.1.0`, which agrees with the
 * default; `patch` lands the warned `0.0.1`; `major` lands `1.0.0`. Counting
 * from the manifest core instead would let a `0.1.0-prerelease` placeholder
 * resolve `--release-as minor` to `0.2.0`, skipping the `0.1.0` that never
 * shipped.
 */
const PLACEHOLDER_BASE_VERSION = '0.0.0'

/**
 * True when `version` is a scaffolded placeholder rather than a shipped
 * number: the literal `0.0.0`, or any prerelease form such as
 * `0.1.0-prerelease` or `1.0.0-rc.1`. Build metadata is stripped first —
 * semver puts it after `+`, so `0.0.0+build` is still `0.0.0`.
 */
export function isPlaceholderVersion(version: string): boolean {
  return (
    version.split('+')[0] === PLACEHOLDER_BASE_VERSION ||
    isPrereleaseVersion(version)
  )
}

export interface PlaceholderReleaseConfig {
  /**
   * Every `## <version>` section already in CHANGELOG.md. A changelog that
   * documents a shipped version outranks a placeholder-looking manifest.
   */
  changelogVersions?: readonly string[] | undefined
  /**
   * True when the release anchor resolved a PRIOR release — a reachable
   * release tag, or a registry-published version.
   */
  hasPriorRelease: boolean
  /**
   * The version-source manifest's current version.
   */
  manifestVersion: string
  /**
   * The operator's `--release-as` argument, verbatim and unparsed.
   */
  releaseAs?: string | undefined
}

export interface PlaceholderReleaseDecision {
  /**
   * Lines `bump.mts` prints so the operator sees the reasoning BEFORE the
   * write — `--dry-run` prints the identical set.
   */
  announcement: readonly string[]
  /**
   * True when the repo still carries the unreleased placeholder version.
   */
  placeholder: boolean
  /**
   * The version this decision LANDS, or `undefined` when the decision does not
   * own the version: a repo that already released, or a `--release-as` this
   * helper cannot parse. An unparseable argument is left to the CLI's own
   * validation, which fails loud.
   */
  version: string | undefined
  /**
   * A loud caution that never blocks the release.
   */
  warning: string | undefined
}

/**
 * The version an explicit `--release-as` names in placeholder state, or
 * `undefined` when the argument is neither a level nor an exact `X.Y.Z`.
 */
function namedPlaceholderVersion(releaseAs: string): string | undefined {
  if (releaseAs === 'major' || releaseAs === 'minor' || releaseAs === 'patch') {
    return computeNextVersion(PLACEHOLDER_BASE_VERSION, releaseAs)
  }
  return /^\d+\.\d+\.\d+$/.test(releaseAs) ? releaseAs : undefined
}

const NOT_PLACEHOLDER: PlaceholderReleaseDecision = {
  announcement: [],
  placeholder: false,
  version: undefined,
  warning: undefined,
}

/**
 * Decide what a bump releases when the package still carries the placeholder
 * version. Returns `NOT_PLACEHOLDER`-shaped output — `placeholder: false`,
 * `version: undefined` — for every repo that has already released, so the
 * caller's existing commit-derived path stays untouched.
 */
export function decidePlaceholderRelease(
  config: PlaceholderReleaseConfig,
): PlaceholderReleaseDecision {
  const { changelogVersions, hasPriorRelease, manifestVersion, releaseAs } = {
    __proto__: null,
    ...config,
  } as PlaceholderReleaseConfig
  const isPlaceholder =
    !hasPriorRelease &&
    (changelogVersions?.length ?? 0) === 0 &&
    isPlaceholderVersion(manifestVersion)
  if (!isPlaceholder) {
    return NOT_PLACEHOLDER
  }
  const detected =
    `Placeholder release state: the version source reads ${manifestVersion} ` +
    `and nothing has shipped yet — no release tag, no published version, no ` +
    `CHANGELOG version section.`
  if (releaseAs === undefined) {
    return {
      announcement: [
        detected,
        `Releasing as ${FIRST_RELEASE_VERSION}: a package leaving the ` +
          `placeholder version cuts ${FIRST_RELEASE_VERSION} first, not the ` +
          `commit-derived bump and not 1.0.0. With no released base, all of ` +
          `history is in range, so a single feat! would ask for a major.`,
        `Override with --release-as <major|minor|patch|X.Y.Z> — the version ` +
          `is still the owner's decision.`,
      ],
      placeholder: true,
      version: FIRST_RELEASE_VERSION,
      warning: undefined,
    }
  }
  const named = namedPlaceholderVersion(releaseAs)
  if (named === undefined) {
    // An unparseable --release-as is the CLI's error to report, with its own
    // What/Where/Saw/Fix message. Cede the decision rather than swallow it.
    return {
      announcement: [detected],
      placeholder: true,
      version: undefined,
      warning: undefined,
    }
  }
  return {
    announcement: [
      detected,
      `--release-as ${releaseAs} names ${named} — honoring it over the ` +
        `${FIRST_RELEASE_VERSION} placeholder default.`,
    ],
    placeholder: true,
    version: named,
    warning: gt(FIRST_RELEASE_VERSION, named)
      ? `--release-as ${releaseAs} lands ${named}, BELOW ` +
        `${FIRST_RELEASE_VERSION}. A package leaving the placeholder version ` +
        `conventionally starts at ${FIRST_RELEASE_VERSION}; ${named} reads as ` +
        `a patch on a release that never happened. Proceeding with ${named}.`
      : undefined,
  }
}
