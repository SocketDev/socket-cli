import { describe, expect, it } from 'vitest'

import { checkCliPackageShape } from '../../../scripts/repo/check/cli-package-is-single.mts'

const manifest = { name: '@socketsecurity/cli', version: '2.2.0-prerelease' }
const published = ['@socketsecurity/cli']

describe('single-package CLI layout', () => {
  it('accepts the root prerelease package', () => {
    expect(checkCliPackageShape(manifest, published)).toEqual([])
  })
  it.each(['0.0.0', '2.1.0', '3.0.0-prerelease', 'invalid', undefined])(
    'rejects an unsupported version %s',
    version => {
      expect(
        checkCliPackageShape({ ...manifest, version }, published),
      ).toHaveLength(1)
    },
  )
  it('rejects a private root package', () => {
    expect(
      checkCliPackageShape({ ...manifest, private: true }, published),
    ).toHaveLength(1)
  })
  it('rejects another package identity', () => {
    expect(
      checkCliPackageShape({ ...manifest, name: 'example-cli' }, published),
    ).toHaveLength(1)
  })
  it('rejects alternate published packages', () => {
    expect(
      checkCliPackageShape(manifest, [...published, 'example-wrapper']),
    ).toHaveLength(1)
  })
})
