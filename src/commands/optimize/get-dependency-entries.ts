import type { EditablePackageJson } from '@socketsecurity/registry/lib/packages'

export function getDependencyEntries(editablePkgJson: EditablePackageJson) {
  const {
    dependencies,
    devDependencies,
    optionalDependencies,
    peerDependencies
  } = editablePkgJson.content
  return [
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
  ].filter(({ 1: o }) => o) as Array<[string, NonNullable<typeof dependencies>]>
}
