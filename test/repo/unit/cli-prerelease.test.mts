import { describe, expect, it } from 'vitest'

import { cliPrereleaseVersion } from '../../../scripts/repo/bump.mts'

const sourceSha = '0123456789abcdef0123456789abcdef01234567'

describe('Socket CLI prerelease generation', () => {
  it('uses the source commit UTC date and short SHA', () => {
    expect(
      cliPrereleaseVersion(
        '2.2.0-prerelease',
        sourceSha,
        '2026-09-17T23:30:00-04:00',
      ),
    ).toBe('2.2.0-prerelease.20260918-0123456')
  })

  it('retains the committed version core for subsequent releases', () => {
    expect(
      cliPrereleaseVersion(
        '2.2.3-prerelease.20260917-abcdef0',
        sourceSha,
        '2026-09-18T00:00:00Z',
      ),
    ).toBe('2.2.3-prerelease.20260918-0123456')
  })

  it.each(['1.2.0-prerelease', '3.0.0-prerelease', '2.2.0', 'invalid'])(
    'rejects unsupported version %s',
    version => {
      expect(() =>
        cliPrereleaseVersion(version, sourceSha, '2026-09-18T00:00:00Z'),
      ).toThrow()
    },
  )

  it.each(['0123456', 'not-a-commit', sourceSha.toUpperCase()])(
    'rejects malformed source SHA %s',
    sha => {
      expect(() =>
        cliPrereleaseVersion('2.2.0-prerelease', sha, '2026-09-18T00:00:00Z'),
      ).toThrow()
    },
  )

  it('rejects invalid source dates', () => {
    expect(() =>
      cliPrereleaseVersion('2.2.0-prerelease', sourceSha, 'invalid'),
    ).toThrow()
  })
})
