/**
 * Unit tests for the zpm scrubber adapter.
 *
 * Routes zpm's structured log lines (➤ prefix, YN#### codes, "Done in
 * Xs") to noise; passes everything else through unchanged.
 *
 * Related Files:
 * - src/util/output/adapters/zpm.mts
 */

import { describe, expect, it } from 'vitest'

import { zpmAdapter } from '../../../../../src/util/output/adapters/zpm.mts'

describe('zpmAdapter', () => {
  it('exposes the zpm name', () => {
    expect(zpmAdapter.name).toBe('zpm')
  })

  it('routes ➤ bullet lines to noise', () => {
    expect(zpmAdapter.classify('➤ YN0000: Resolution step')).toBe('noise')
    expect(zpmAdapter.classify('  ➤ YN0001: Fetch step')).toBe('noise')
  })

  it('routes YN-coded lines to noise', () => {
    expect(zpmAdapter.classify('YN0042: status update')).toBe('noise')
  })

  it('routes "Done in" lines to noise', () => {
    expect(zpmAdapter.classify('Done in 0s 123ms')).toBe('noise')
  })

  it('returns undefined for unknown lines', () => {
    expect(zpmAdapter.classify('plain text')).toBeUndefined()
    expect(zpmAdapter.classify('')).toBeUndefined()
    expect(zpmAdapter.classify('error: bad arg')).toBeUndefined()
  })

  it('does not match arbitrary numeric prefixes', () => {
    expect(zpmAdapter.classify('YN42: too short')).toBeUndefined()
    expect(zpmAdapter.classify('Done now')).toBeUndefined()
  })
})
