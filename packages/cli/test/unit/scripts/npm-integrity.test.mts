import { computeHash } from '@socketsecurity/lib-stable/integrity'
import { describe, expect, it } from 'vitest'

import {
  assertInstalledMatchesPin,
  collectNpmToolPins,
  parseDeclaredToolIntegrity,
  readInstalledPackageIntegrity,
} from '../../../scripts/sea-build-utils/npm-integrity.mts'

import type {
  HiddenLockfile,
  NpmToolPin,
} from '../../../scripts/sea-build-utils/npm-integrity.mts'

const LOCKFILE_PATH = '/tmp/build/node_modules/.package-lock.json'

const PINNED_SRI = computeHash(Buffer.from('the pinned tarball'), 'sha512').sri
const OTHER_SRI = computeHash(Buffer.from('a different tarball'), 'sha512').sri

function makePin(overrides?: Partial<NpmToolPin> | undefined): NpmToolPin {
  return {
    integrity: PINNED_SRI,
    name: '@coana-tech/cli',
    version: '15.9.5',
    ...overrides,
  }
}

function makeLockfile(integrity: string | undefined): HiddenLockfile {
  return {
    packages: {
      'node_modules/@coana-tech/cli': { integrity },
    },
  }
}

describe('collectNpmToolPins', () => {
  it('collects only the npm-sourced tools', () => {
    const pins = collectNpmToolPins({
      '@coana-tech/cli': {
        integrity: PINNED_SRI,
        packageManager: 'npm',
        version: '15.9.5',
      },
      trivy: { checksums: {}, release: 'asset', version: 'v0.69.2' },
    })

    expect(pins).toEqual([
      {
        integrity: PINNED_SRI,
        name: '@coana-tech/cli',
        version: '15.9.5',
      },
    ])
  })

  it('keeps an npm tool that declares no integrity so it can be reported', () => {
    const pins = collectNpmToolPins({
      synp: { packageManager: 'npm', version: '1.9.14' },
    })

    expect(pins[0]!.integrity).toBe(undefined)
  })
})

describe('parseDeclaredToolIntegrity', () => {
  it('parses a well-formed sha512 SRI', () => {
    expect(parseDeclaredToolIntegrity('synp', PINNED_SRI).sri).toBe(PINNED_SRI)
  })

  it('fails loud when the pin is absent rather than skipping', () => {
    expect(() => parseDeclaredToolIntegrity('synp', undefined)).toThrow(
      /Missing integrity pin for npm tool "synp"/,
    )
  })

  it('fails loud when the pin is an empty string', () => {
    expect(() => parseDeclaredToolIntegrity('synp', '')).toThrow(
      /Missing integrity pin/,
    )
  })

  it('fails loud when the pin is malformed', () => {
    expect(() => parseDeclaredToolIntegrity('synp', 'not-an-sri')).toThrow(
      /Malformed integrity pin for npm tool "synp"/,
    )
  })
})

describe('readInstalledPackageIntegrity', () => {
  it('reads the integrity npm recorded', () => {
    expect(
      readInstalledPackageIntegrity(
        '@coana-tech/cli',
        makeLockfile(PINNED_SRI),
        LOCKFILE_PATH,
      ),
    ).toBe(PINNED_SRI)
  })

  it('fails loud when npm recorded no integrity', () => {
    expect(() =>
      readInstalledPackageIntegrity(
        '@coana-tech/cli',
        makeLockfile(undefined),
        LOCKFILE_PATH,
      ),
    ).toThrow(/npm recorded none/)
  })

  it('fails loud when the package is absent from the lockfile', () => {
    expect(() =>
      readInstalledPackageIntegrity('@coana-tech/cli', {}, LOCKFILE_PATH),
    ).toThrow(/npm recorded none/)
  })
})

describe('assertInstalledMatchesPin', () => {
  it('passes when the installed hash matches the pin', () => {
    expect(() =>
      assertInstalledMatchesPin(
        makePin(),
        makeLockfile(PINNED_SRI),
        LOCKFILE_PATH,
      ),
    ).not.toThrow()
  })

  it('fails loud when the installed tarball is not the pinned one', () => {
    expect(() =>
      assertInstalledMatchesPin(
        makePin(),
        makeLockfile(OTHER_SRI),
        LOCKFILE_PATH,
      ),
    ).toThrow(/Integrity mismatch for npm tool "@coana-tech\/cli@15\.9\.5"/)
  })

  it('names both sides and the fix in the mismatch error', () => {
    let message = ''
    try {
      assertInstalledMatchesPin(
        makePin(),
        makeLockfile(OTHER_SRI),
        LOCKFILE_PATH,
      )
    } catch (e) {
      message = (e as Error).message
    }

    expect(message).toContain(LOCKFILE_PATH)
    expect(message).toContain(`Saw: ${OTHER_SRI}`)
    expect(message).toContain(`Wanted: ${PINNED_SRI}`)
    expect(message).toContain('supply-chain event')
  })

  it('fails loud when the tool declares no pin', () => {
    expect(() =>
      assertInstalledMatchesPin(
        makePin({ integrity: undefined }),
        makeLockfile(PINNED_SRI),
        LOCKFILE_PATH,
      ),
    ).toThrow(/Missing integrity pin/)
  })

  it('fails loud when npm recorded an unparseable hash', () => {
    expect(() =>
      assertInstalledMatchesPin(
        makePin(),
        makeLockfile('garbage'),
        LOCKFILE_PATH,
      ),
    ).toThrow(/unparseable hash/)
  })

  it('treats a one-character corruption of the pin as a mismatch, not a pass', () => {
    // Flip one base64 character mid-body so the SRI stays well-formed and the
    // failure lands on the comparison rather than on the parse.
    const body = PINNED_SRI.slice('sha512-'.length)
    const corrupted = `sha512-${body.slice(0, 5)}${body[5] === 'A' ? 'B' : 'A'}${body.slice(6)}`

    expect(corrupted).not.toBe(PINNED_SRI)
    expect(() =>
      assertInstalledMatchesPin(
        makePin({ integrity: corrupted }),
        makeLockfile(PINNED_SRI),
        LOCKFILE_PATH,
      ),
    ).toThrow(/Integrity mismatch/)
  })
})
