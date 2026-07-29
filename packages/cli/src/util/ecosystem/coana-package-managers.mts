/**
 * Package manager identifiers accepted by Coana's `--package-managers` filter.
 * `socket fix` uses them to narrow fix computation within an ecosystem — only
 * the PNPM artifacts in a mixed pnpm/yarn/npm repo, for example.
 *
 * Mirrors the list Coana's `getFilterablePackageManagers()` returns. Keep in
 * sync when bumping @coana-tech/cli.
 */

export const COANA_PACKAGE_MANAGERS = [
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

export type CoanaPackageManager = (typeof COANA_PACKAGE_MANAGERS)[number]

const COANA_PACKAGE_MANAGERS_SET = new Set<string>(COANA_PACKAGE_MANAGERS)

export function isCoanaPackageManager(
  value: string,
): value is CoanaPackageManager {
  return COANA_PACKAGE_MANAGERS_SET.has(value)
}
