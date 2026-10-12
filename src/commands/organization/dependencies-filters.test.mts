import { describe, expect, it } from 'vitest'

import {
  matchesConfirmedPurls,
  parseDependenciesPurls,
  parsePurlsOption,
} from './dependencies-filters.mts'

describe('parsePurlsOption', () => {
  it('treats an omitted multi-value flag as unfiltered', () => {
    expect(parsePurlsOption([], [])).toEqual({ ok: true, purls: undefined })
  })

  it('rejects a bare multi-value flag', () => {
    expect(parsePurlsOption(['--purls'], undefined)).toMatchObject({
      ok: false,
    })
  })

  it('rejects non-array values from CLI flags', () => {
    expect(parsePurlsOption(['--purls'], 'pkg:npm/minimist')).toMatchObject({
      ok: false,
    })
  })
})

describe('parseDependenciesPurls', () => {
  it('leaves an omitted filter undefined', () => {
    expect(parseDependenciesPurls(undefined)).toEqual({
      ok: true,
      purls: undefined,
    })
  })

  it('trims and deduplicates complete PURLs in first-seen order', () => {
    expect(
      parseDependenciesPurls([
        ' pkg:npm/%40types/node ',
        'pkg:pypi/requests@2.32.3',
        'pkg:npm/%40types/node',
      ]),
    ).toEqual({
      ok: true,
      purls: ['pkg:npm/%40types/node', 'pkg:pypi/requests@2.32.3'],
    })
  })

  it('accepts versionless and punctuation package identities', () => {
    expect(
      parseDependenciesPurls(['pkg:npm/example.package', 'pkg:pypi/requests']),
    ).toEqual({
      ok: true,
      purls: ['pkg:npm/example.package', 'pkg:pypi/requests'],
    })
  })

  it('does not impose an ecosystem allowlist', () => {
    expect(parseDependenciesPurls(['pkg:fixture-ecosystem/example'])).toEqual({
      ok: true,
      purls: ['pkg:fixture-ecosystem/example'],
    })
  })

  it('rejects bare, blank, and malformed PURLs', () => {
    expect(parseDependenciesPurls(['minimist'])).toMatchObject({ ok: false })
    expect(parseDependenciesPurls(['   '])).toMatchObject({ ok: false })
    expect(parseDependenciesPurls([])).toMatchObject({ ok: false })
    expect(parseDependenciesPurls(['pkg:npm/'])).toMatchObject({ ok: false })
  })

  it('rejects qualifiers and subpaths', () => {
    expect(parseDependenciesPurls(['pkg:npm/minimist?arch=x64'])).toMatchObject(
      { ok: false },
    )
    expect(parseDependenciesPurls(['pkg:npm/minimist#nested'])).toMatchObject({
      ok: false,
    })
  })
})

describe('matchesConfirmedPurls', () => {
  it('requires exact server confirmation with no invalid filters', () => {
    expect(
      matchesConfirmedPurls(['pkg:npm/minimist'], {
        valid: ['pkg:npm/minimist'],
        invalid: [],
      }),
    ).toBe(true)
    expect(
      matchesConfirmedPurls(['pkg:npm/minimist'], {
        valid: [],
        invalid: ['pkg:npm/minimist'],
      }),
    ).toBe(false)
    expect(
      matchesConfirmedPurls(['pkg:npm/minimist'], {
        valid: ['pkg:npm/minimist'],
        invalid: ['pkg:pypi/requests'],
      }),
    ).toBe(false)
    expect(
      matchesConfirmedPurls(['pkg:npm/minimist'], {
        valid: ['pkg:npm/minimist'],
      }),
    ).toBe(false)
    expect(
      matchesConfirmedPurls(['pkg:npm/minimist'], {
        valid: ['pkg:npm/other'],
        invalid: [],
      }),
    ).toBe(false)
  })
})
