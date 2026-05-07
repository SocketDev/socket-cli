/**
 * Unit tests for Socket Patch version getter.
 *
 * Related Files:
 * - src/env/socket-patch-version.mts
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getSocketPatchVersion } from '../../../src/env/socket-patch-version.mts'

describe('env/socket-patch-version', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env['INLINED_SOCKET_PATCH_VERSION']
  })

  afterEach(() => {
    if (original !== undefined) {
      process.env['INLINED_SOCKET_PATCH_VERSION'] = original
    } else {
      delete process.env['INLINED_SOCKET_PATCH_VERSION']
    }
  })

  it('returns the version string when the env var is set', () => {
    process.env['INLINED_SOCKET_PATCH_VERSION'] = '1.2.3'
    expect(getSocketPatchVersion()).toBe('1.2.3')
  })

  it('throws when the env var is missing', () => {
    delete process.env['INLINED_SOCKET_PATCH_VERSION']
    expect(() => getSocketPatchVersion()).toThrow(/INLINED_SOCKET_PATCH_VERSION/)
  })

  it('throws when the env var is the empty string', () => {
    process.env['INLINED_SOCKET_PATCH_VERSION'] = ''
    expect(() => getSocketPatchVersion()).toThrow(/INLINED_SOCKET_PATCH_VERSION/)
  })
})
