/**
 * Package manager identifiers accepted by Coana's --package-managers filter.
 * Used by `socket fix` to narrow fix computation to specific package managers
 * within an ecosystem (e.g. only PNPM artifacts in a mixed pnpm/yarn/npm repo).
 *
 * Mirrors the list returned by Coana's `getFilterablePackageManagers()` in
 * packages/web-compat-utils/src/package-manager-utils.ts.
 */

export const ALL_PACKAGE_MANAGERS = [
  'CARGO',
  'COMPOSER',
  'GO',
  'GRADLE',
  'MAVEN',
  'NPM',
  'NUGET',
  'PIPENV',
  'PIP_REQUIREMENTS',
  'PNPM',
  'POETRY',
  'RUBYGEMS',
  'RUSH',
  'SBT',
  'YARN',
] as const

export type PackageManager = (typeof ALL_PACKAGE_MANAGERS)[number]

const ALL_PACKAGE_MANAGERS_SET = new Set<string>(ALL_PACKAGE_MANAGERS)

export function getPackageManagerChoicesForMeow(): string[] {
  return [...ALL_PACKAGE_MANAGERS]
}

export function isValidPackageManager(value: string): value is PackageManager {
  return ALL_PACKAGE_MANAGERS_SET.has(value)
}
