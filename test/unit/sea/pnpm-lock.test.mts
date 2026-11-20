import { describe, expect, it } from 'vitest'

import {
  findLockedPackageIntegrity,
  parsePnpmLock,
} from '../../../src/sea/pnpm-lock.mts'

const INTEGRITY = 'sha512-YWJj'

describe('pnpm lockfile parsing', () => {
  it('reads a single-document pnpm lockfile', () => {
    const lock = `
lockfileVersion: '9.0'
packages:
  sample@1.0.0:
    resolution: {integrity: ${INTEGRITY}}
`

    expect(findLockedPackageIntegrity(lock, 'sample', '1.0.0')).toBe(INTEGRITY)
  })

  it('selects the project graph when tooling has more packages', () => {
    const lock = `
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.21.0
        version: 12.21.0
packages:
  pnpm@12.21.0: {}
  pnpm-tooling@1.0.0: {}
---
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      sample:
        specifier: 1.0.0
        version: 1.0.0
packages:
  sample@1.0.0:
    resolution: {integrity: ${INTEGRITY}}
`

    expect(Object.keys(parsePnpmLock(lock).packages ?? {})).toEqual([
      'sample@1.0.0',
    ])
    expect(findLockedPackageIntegrity(lock, 'sample', '1.0.0')).toBe(INTEGRITY)
  })

  it('resolves pnpm 12 patch hashes to their workspace file paths', () => {
    const lock = `
lockfileVersion: '9.0'
packages:
  sample@1.0.0:
    resolution: {integrity: ${INTEGRITY}}
patchedDependencies:
  sample@1.0.0: patch-hash
`
    const workspace = `
patchedDependencies:
  sample@1.0.0: patches/sample.patch
`

    expect(parsePnpmLock(lock, workspace).patchedDependencies).toEqual({
      'sample@1.0.0': { hash: 'patch-hash', path: 'patches/sample.patch' },
    })
  })
})
