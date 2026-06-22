import { describe, expect, it } from 'vitest'

import { parseBuildToolOpts } from './parse-build-tool-opts.mts'

describe('parseBuildToolOpts', () => {
  it('returns an empty array for empty/undefined input', () => {
    expect(parseBuildToolOpts(undefined)).toEqual([])
    expect(parseBuildToolOpts('')).toEqual([])
    expect(parseBuildToolOpts('   ')).toEqual([])
  })

  it('splits a plain space-separated string (parity with the old split)', () => {
    expect(parseBuildToolOpts('-P release -s settings.xml')).toEqual([
      '-P',
      'release',
      '-s',
      'settings.xml',
    ])
  })

  it('collapses runs of whitespace and trims', () => {
    expect(parseBuildToolOpts('  -P   release  ')).toEqual(['-P', 'release'])
  })

  it('keeps a double-quoted value with spaces as one token', () => {
    expect(parseBuildToolOpts('-s "my settings.xml"')).toEqual([
      '-s',
      'my settings.xml',
    ])
  })

  it('keeps a single-quoted value with spaces as one token', () => {
    expect(parseBuildToolOpts("-s 'my settings.xml'")).toEqual([
      '-s',
      'my settings.xml',
    ])
  })

  it('handles quotes inside a token', () => {
    expect(parseBuildToolOpts('-Dprop="a b"')).toEqual(['-Dprop=a b'])
  })
})
