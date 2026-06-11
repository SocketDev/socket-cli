/**
 * @file The ONE soak-policy reader + decision, shared by every surface that
 *   asks "is this dependency old enough, or is it bypassed?". The canonical
 *   rule lives in `pnpm-workspace.yaml`: a `minimumReleaseAge` scalar (minutes
 *   a release must soak) plus a `minimumReleaseAgeExclude` bypass list. pnpm
 *   itself enforces this for npm catalog installs. Other soak surfaces —
 *   `update-external-tools.mts` (security-tool binaries) and the
 *   `soak-excludes-have-dates` check — historically each re-derived "what's
 *   exempt" their own way (a separate `isSocketSourced` rule, a duplicated glob
 *   regex), so the three could diverge. This module is the single reader +
 *   matcher they all consult, so the answer is identical everywhere. An exclude
 *   entry matches by pnpm's own semantics: a GLOB (`@scope/*`) excludes any
 *   package under the scope at ANY version; a BARE name (`sfw`) excludes
 *   exactly that package at any version; a PINNED `name@version`
 *   (`rolldown@1.1.0`) excludes only that exact version.
 */

import { readFileSync } from 'node:fs'

export interface SoakRules {
  /**
   * `minimumReleaseAge` in minutes; 0 when the key is absent (no soak).
   */
  readonly minutes: number
  /**
   * The raw `minimumReleaseAgeExclude` entries, verbatim (globs, bare names,
   * name@version).
   */
  readonly exclude: readonly string[]
}

/**
 * Parse the soak rules from a `pnpm-workspace.yaml`'s text. Pulls the
 * `minimumReleaseAge` scalar + every `minimumReleaseAgeExclude:` list bullet.
 * Tolerant of comments/annotations interleaved in the list. Returns `{ minutes:
 * 0, exclude: [] }` when the keys are absent — the file is the explicit canon,
 * so absence means "no soak / nothing excluded", not a default.
 */
export function parseSoakRules(yamlText: string): SoakRules {
  // Match a `minimumReleaseAge:` line anywhere in the YAML (the `m` flag makes
  // `^`/`$` line-anchored): optional indent, the key, optional quotes around the
  // digit run we capture in group 1, then an optional trailing `# comment`.
  const minutesMatch =
    /^\s*minimumReleaseAge:\s*['"]?(\d+)['"]?\s*(?:#.*)?$/m.exec(yamlText)
  const minutes = minutesMatch?.[1] ? parseInt(minutesMatch[1], 10) : 0

  const exclude: string[] = []
  const lines = yamlText.split('\n')
  let inBlock = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (/^\s*minimumReleaseAgeExclude:\s*$/.test(line)) {
      inBlock = true
      continue
    }
    if (!inBlock) {
      continue
    }
    // A new top-level (non-indented) key ends the list block.
    if (/^[A-Za-z_][\w-]*:\s*(?:\S.*)?$/.test(line) && !line.startsWith(' ')) {
      break
    }
    // A list bullet: `  - 'entry'` / `  - entry`. Comments + blanks are skipped.
    const m = /^\s*-\s*['"]?([^'"\s]+)['"]?\s*(?:#.*)?$/.exec(line)
    if (m?.[1]) {
      exclude.push(m[1])
    }
  }
  return { minutes, exclude }
}

/**
 * Read + parse the soak rules from a `pnpm-workspace.yaml` on disk.
 */
export function readSoakRules(yamlPath: string): SoakRules {
  return parseSoakRules(readFileSync(yamlPath, 'utf8'))
}

/**
 * Does a single `minimumReleaseAgeExclude` entry match `name` (and optionally
 * `version`)? The three entry shapes:
 *
 * - `<prefix>*` glob → name starts with the prefix (the part before `*`).
 *   `@scope/*` matches `@scope/anything`; `socket-*` matches `socket-foo`.
 * - Bare `<name>` → exact name match, any version.
 * - `<name>@<version>` → exact name AND exact version (when `version` known; if
 *   the caller doesn't know the version, a name match alone counts).
 */
export function excludeEntryMatches(
  entry: string,
  name: string,
  version?: string | undefined,
): boolean {
  const starIdx = entry.indexOf('*')
  if (starIdx !== -1) {
    return name.startsWith(entry.slice(0, starIdx))
  }
  const atIdx = entry.lastIndexOf('@')
  // `atIdx > 0` so a leading-`@` scope name (`@scope/pkg`) isn't read as a
  // version delimiter; a real `name@version` has the `@` after position 0.
  if (atIdx > 0) {
    const entryName = entry.slice(0, atIdx)
    const entryVersion = entry.slice(atIdx + 1)
    if (entryName !== name) {
      return false
    }
    return version === undefined || version === entryVersion
  }
  return entry === name
}

/**
 * Is `name` (optionally at `version`) excluded from the soak by ANY rule in
 * `exclude`? This is the single allow/soak decision every surface shares.
 */
export function isSoakExcluded(
  name: string,
  version: string | undefined,
  exclude: readonly string[],
): boolean {
  for (let i = 0, { length } = exclude; i < length; i += 1) {
    if (excludeEntryMatches(exclude[i]!, name, version)) {
      return true
    }
  }
  return false
}
