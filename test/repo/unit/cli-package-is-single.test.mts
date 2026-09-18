import { describe, expect, it } from 'vitest'

import {
  checkCliPackageShape,
  checkCliReleaseVersion,
} from '../../../scripts/repo/check/cli-package-is-single.mts'

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

describe('Socket CLI release version', () => {
  const release = {
    date: '20260917',
    distTag: 'prerelease',
    sha: '0fff6d664f29',
    version: '2.2.0-prerelease.20260917-0fff6d6',
  }

  it('accepts the date and source SHA release identity', () => {
    expect(checkCliReleaseVersion(release)).toEqual([])
  })

  it.each([
    '2.2.0-prerelease',
    '2.2.0-prerelease.20260917-0FFF6D6',
    '2.2.0-prerelease.20260917-0fff6d66',
    '1.2.0-prerelease.20260917-0fff6d6',
  ])('rejects invalid release version %s', version => {
    expect(checkCliReleaseVersion({ ...release, version })).toHaveLength(1)
  })

  it('rejects another date or source SHA', () => {
    expect(
      checkCliReleaseVersion({ ...release, date: '20260918' }),
    ).toHaveLength(1)
    expect(
      checkCliReleaseVersion({ ...release, sha: 'abcdef012345' }),
    ).toHaveLength(1)
  })

  it('rejects the latest dist-tag', () => {
    expect(
      checkCliReleaseVersion({ ...release, distTag: 'latest' }),
    ).toHaveLength(1)
  })
})
