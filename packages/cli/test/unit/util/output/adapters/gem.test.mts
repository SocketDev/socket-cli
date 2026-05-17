/**
 * Unit tests for the gem scrubber adapter.
 *
 * Drops dot-progress lines and routes RubyGems status lines to noise;
 * passes anything else through unchanged.
 *
 * Related Files:
 * - src/util/output/adapters/gem.mts
 */

import { describe, expect, it } from 'vitest'

import { gemAdapter } from '../../../../../src/util/output/adapters/gem.mts'

describe('gemAdapter', () => {
  it('exposes the gem name', () => {
    expect(gemAdapter.name).toBe('gem')
  })

  it('drops dot-progress lines', () => {
    expect(gemAdapter.classify('.....')).toBe('drop')
    expect(gemAdapter.classify('  ....  ')).toBe('drop')
    expect(gemAdapter.classify('.')).toBe('drop')
  })

  it.each([
    'Fetching rake-13.0.6.gem',
    'Fetching: rake',
    'Installing rake',
    'Installed rake-13.0.6',
    'Installing ri documentation for rake',
    'Installing RDoc documentation for rake',
    'Parsing documentation for rake',
    'Done installing documentation for rake',
    'Successfully installed rake-13.0.6',
    'Successfully uninstalled rake-13.0.6',
    'Building native extensions. This could take a while...',
    '1 gem installed',
    '5 gems installed',
    '1 gem uninstalled',
    '3 gems uninstalled',
  ])('routes %s to noise', line => {
    expect(gemAdapter.classify(line)).toBe('noise')
  })

  it('returns undefined for unknown lines', () => {
    expect(gemAdapter.classify('plain text')).toBeUndefined()
    expect(gemAdapter.classify('error: failed to fetch')).toBeUndefined()
    expect(gemAdapter.classify('')).toBeUndefined()
  })

  it('does not match status keywords without proper prefix', () => {
    // The status regex requires the keyword at the start.
    expect(gemAdapter.classify('  Fetching rake')).toBeUndefined()
  })
})
