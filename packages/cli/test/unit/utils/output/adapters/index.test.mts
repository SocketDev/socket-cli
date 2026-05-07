/**
 * Unit tests for the scrubber adapter registry.
 *
 * Confirms the lookup table returns the right adapter for known tool
 * keys (gem / synp / zpm) and `undefined` for unknown ones.
 *
 * Related Files:
 * - src/utils/output/adapters/index.mts
 */

import { describe, expect, it } from 'vitest'

import {
  gemAdapter,
  getScrubberAdapter,
  synpAdapter,
  zpmAdapter,
} from '../../../../../src/utils/output/adapters/index.mts'

describe('output/adapters/index', () => {
  it('returns the gem adapter for "gem"', () => {
    expect(getScrubberAdapter('gem')).toBe(gemAdapter)
  })

  it('returns the synp adapter for "synp"', () => {
    expect(getScrubberAdapter('synp')).toBe(synpAdapter)
  })

  it('returns the zpm adapter for "zpm"', () => {
    expect(getScrubberAdapter('zpm')).toBe(zpmAdapter)
  })

  it('returns undefined for unknown tool keys', () => {
    expect(getScrubberAdapter('unknown')).toBeUndefined()
    expect(getScrubberAdapter('')).toBeUndefined()
  })

  it('does not expose prototype chain pollution', () => {
    // The registry uses Object.create(null) so toString lookups should miss.
    expect(getScrubberAdapter('toString')).toBeUndefined()
    expect(getScrubberAdapter('hasOwnProperty')).toBeUndefined()
  })
})
