import { stripVTControlCharacters } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

export async function getSymbols(term: string): Promise<{
  fail: string
  info: string
  success: string
  warn: string
}> {
  vi.stubGlobal('process', {
    ...process,
    platform: 'win32',
    env: { TERM: term, NO_COLOR: '1' },
  })
  vi.resetModules()
  const { LOG_SYMBOLS } = await import('../../../src/utils/logger.mts')
  return {
    fail: stripVTControlCharacters(LOG_SYMBOLS.fail),
    info: stripVTControlCharacters(LOG_SYMBOLS.info),
    success: stripVTControlCharacters(LOG_SYMBOLS.success),
    warn: stripVTControlCharacters(LOG_SYMBOLS.warn),
  }
}

describe('Logger symbols on Windows', () => {
  it('uses fallback symbols for TERM=xterm', async () => {
    expect(await getSymbols('xterm')).toEqual({
      fail: '×',
      info: 'i',
      success: '√',
      warn: '‼',
    })
  })

  it('uses Unicode symbols for TERM=xterm-256color', async () => {
    expect(await getSymbols('xterm-256color')).toEqual({
      fail: '✖',
      info: 'ℹ',
      success: '✔',
      warn: '⚠',
    })
  })

  it('uses fallback symbols for unknown terminals', async () => {
    expect(await getSymbols('unknown')).toEqual({
      fail: '×',
      info: 'i',
      success: '√',
      warn: '‼',
    })
  })
})
