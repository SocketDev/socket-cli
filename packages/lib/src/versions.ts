/** @fileoverview Version comparison and validation utilities for Socket ecosystem. */

let _semver: typeof import('semver') | undefined
/*@__NO_SIDE_EFFECTS__*/
function getSemver() {
  if (_semver === undefined) {
    // The 'semver' package is browser safe.
    _semver = /*@__PURE__*/ require('semver')
  }
  return _semver as typeof import('semver')
}

/**
 * Coerce a version string to valid semver format.
 */
export function coerceVersion(version: string): string | undefined {
  const coerced = getSemver().coerce(version)
  return coerced?.version
}

/**
 * Compare two semantic version strings.
 * @returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2, or undefined if invalid.
 */
export function compareVersions(
  v1: string,
  v2: string,
): -1 | 0 | 1 | undefined {
  try {
    return getSemver().compare(v1, v2)
  } catch {
    return undefined
  }
}

/**
 * Get all versions from an array that satisfy a semver range.
 */
export function filterVersions(versions: string[], range: string): string[] {
  return versions.filter(v => getSemver().satisfies(v, range))
}

/**
 * Get the major version number from a version string.
 */
export function getMajorVersion(version: string): number | undefined {
  const parsed = getSemver().parse(version)
  return parsed?.major
}

/**
 * Get the minor version number from a version string.
 */
export function getMinorVersion(version: string): number | undefined {
  const parsed = getSemver().parse(version)
  return parsed?.minor
}

/**
 * Get the patch version number from a version string.
 */
export function getPatchVersion(version: string): number | undefined {
  const parsed = getSemver().parse(version)
  return parsed?.patch
}

/**
 * Increment a version by the specified release type.
 */
export function incrementVersion(
  version: string,
  release:
    | 'major'
    | 'minor'
    | 'patch'
    | 'premajor'
    | 'preminor'
    | 'prepatch'
    | 'prerelease',
  identifier?: string | undefined,
): string | undefined {
  return getSemver().inc(version, release, identifier) || undefined
}

/**
 * Check if version1 equals version2.
 */
export function isEqual(version1: string, version2: string): boolean {
  return getSemver().eq(version1, version2)
}

/**
 * Check if version1 is greater than version2.
 */
export function isGreaterThan(version1: string, version2: string): boolean {
  return getSemver().gt(version1, version2)
}

/**
 * Check if version1 is greater than or equal to version2.
 */
export function isGreaterThanOrEqual(
  version1: string,
  version2: string,
): boolean {
  return getSemver().gte(version1, version2)
}

/**
 * Check if version1 is less than version2.
 */
export function isLessThan(version1: string, version2: string): boolean {
  return getSemver().lt(version1, version2)
}

/**
 * Check if version1 is less than or equal to version2.
 */
export function isLessThanOrEqual(version1: string, version2: string): boolean {
  return getSemver().lte(version1, version2)
}

/**
 * Validate if a string is a valid semantic version.
 */
export function isValidVersion(version: string): boolean {
  return getSemver().valid(version) !== null
}

/**
 * Get the highest version from an array of versions.
 */
export function maxVersion(versions: string[]): string | undefined {
  return getSemver().maxSatisfying(versions, '*') || undefined
}

/**
 * Get the lowest version from an array of versions.
 */
export function minVersion(versions: string[]): string | undefined {
  return getSemver().minSatisfying(versions, '*') || undefined
}

/**
 * Parse a version string and return major, minor, patch components.
 */
export function parseVersion(version: string):
  | {
      major: number
      minor: number
      patch: number
      prerelease: ReadonlyArray<string | number>
      build: readonly string[]
    }
  | undefined {
  const parsed = getSemver().parse(version)
  if (!parsed) {
    return undefined
  }
  return {
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    prerelease: parsed.prerelease,
    build: parsed.build,
  }
}

/**
 * Check if a version satisfies a semver range.
 */
export function satisfiesVersion(version: string, range: string): boolean {
  return getSemver().satisfies(version, range)
}

/**
 * Sort versions in ascending order.
 */
export function sortVersions(versions: string[]): string[] {
  return getSemver().sort([...versions])
}

/**
 * Sort versions in descending order.
 */
export function sortVersionsDesc(versions: string[]): string[] {
  return getSemver().rsort([...versions])
}

/**
 * Get the difference between two versions.
 */
export function versionDiff(
  version1: string,
  version2: string,
):
  | 'major'
  | 'premajor'
  | 'minor'
  | 'preminor'
  | 'patch'
  | 'prepatch'
  | 'prerelease'
  | undefined {
  try {
    return getSemver().diff(version1, version2) || undefined
  } catch {
    return undefined
  }
}
