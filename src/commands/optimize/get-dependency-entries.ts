import { readPackageJson } from '@socketsecurity/registry/lib/packages'

type PackageJson = Awaited<ReturnType<typeof readPackageJson>>

export function getDependencyEntries(pkgJson: PackageJson) {
  const {
    dependencies,
    devDependencies,
    optionalDependencies,
    peerDependencies
  } = pkgJson
  return <Array<[string, NonNullable<typeof dependencies>]>>[
    [
      'dependencies',
      dependencies ? { __proto__: null, ...dependencies } : undefined
    ],
    [
      'devDependencies',
      devDependencies ? { __proto__: null, ...devDependencies } : undefined
    ],
    [
      'peerDependencies',
      peerDependencies ? { __proto__: null, ...peerDependencies } : undefined
    ],
    [
      'optionalDependencies',
      optionalDependencies
        ? { __proto__: null, ...optionalDependencies }
        : undefined
    ]
  ].filter(({ 1: o }) => o)
}
