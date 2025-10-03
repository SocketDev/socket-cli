/** @fileoverview Package.json dependency extraction utilities for Socket CLI. Extracts dependency entries (dependencies, devDependencies, peerDependencies, optionalDependencies) from package.json for override processing. */

import type { EnvDetails } from '../../utils/package-environment.mts'

export function getDependencyEntries(pkgEnvDetails: EnvDetails) {
  const {
    dependencies,
    devDependencies,
    optionalDependencies,
    peerDependencies,
  } = pkgEnvDetails.editablePkgJson.content
  return [
    [
      'dependencies',
      dependencies ? { __proto__: null, ...dependencies } : undefined,
    ],
    [
      'devDependencies',
      devDependencies ? { __proto__: null, ...devDependencies } : undefined,
    ],
    [
      'peerDependencies',
      peerDependencies ? { __proto__: null, ...peerDependencies } : undefined,
    ],
    [
      'optionalDependencies',
      optionalDependencies
        ? { __proto__: null, ...optionalDependencies }
        : undefined,
    ],
  ].filter(({ 1: o }) => o) as Array<[string, NonNullable<typeof dependencies>]>
}
