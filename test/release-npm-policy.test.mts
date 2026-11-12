import { describe, expect, it } from 'vitest'

import {
  npmDistTagForRelease,
  validateNpmPolicy,
} from '../scripts/release/validate-npm-policy.mts'

const prereleasePolicy = {
  mode: 'prerelease-only' as const,
  versionHint: '2.1.0',
  identifier: 'rc',
  distTag: 'rc-2.1.0',
}

describe('npm release policy', () => {
  it('chooses the configured tag for prereleases and latest for v1.x', () => {
    expect(npmDistTagForRelease('2.1.0-rc.4', prereleasePolicy)).toBe(
      'rc-2.1.0',
    )
    expect(npmDistTagForRelease('1.14.2', prereleasePolicy)).toBe('latest')
  })

  it('allows the configured prerelease and tag', () => {
    expect(() =>
      validateNpmPolicy('2.1.0-rc.4', 'rc-2.1.0', prereleasePolicy),
    ).not.toThrow()
  })

  it.each([
    ['2.1.0', 'rc-2.1.0'],
    ['2.1.0-rc.4', 'latest'],
    ['2.2.0-rc.0', 'rc-2.1.0'],
  ])('rejects mismatched prerelease version/tag %s %s', (version, tag) => {
    expect(() => validateNpmPolicy(version!, tag!, prereleasePolicy)).toThrow()
  })

  it('keeps the existing v1.x stable release line available', () => {
    expect(() =>
      validateNpmPolicy('1.14.2', 'latest', prereleasePolicy),
    ).not.toThrow()
    expect(() => validateNpmPolicy('1.14.2', 'next', prereleasePolicy)).toThrow(
      'stable v1.x release on the latest dist-tag',
    )
  })
})
