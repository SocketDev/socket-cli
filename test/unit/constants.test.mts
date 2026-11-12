import { describe, expect, it } from 'vitest'

import { resolveBlessedTerm } from '../../src/constants.mts'

describe('Blessed terminal selection', () => {
  it('honors an explicitly configured TERM on every platform', () => {
    expect(resolveBlessedTerm('xterm-256color', true)).toBe('xterm-256color')
    expect(resolveBlessedTerm('xterm', false)).toBe('xterm')
  })

  it('uses platform fallbacks when TERM is not set', () => {
    expect(resolveBlessedTerm(undefined, true)).toBe('windows-ansi')
    expect(resolveBlessedTerm(undefined, false)).toBe('xterm')
  })
})
