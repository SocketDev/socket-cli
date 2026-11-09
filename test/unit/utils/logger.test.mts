import { spawnSync } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'

import { describe, expect, it } from 'vitest'

export function getSymbols(term: string): {
  fail: string
  info: string
  success: string
  warn: string
} {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `Object.defineProperty(process, 'platform', { value: 'win32' });
const { LOG_SYMBOLS } = require('@socketsecurity/registry/lib/logger');
process.stdout.write(JSON.stringify(LOG_SYMBOLS));`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        TERM: term,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        WT_SESSION: '',
        TERM_PROGRAM: '',
        TERMINUS_SUBLIME: '',
        ConEmuTask: '',
        TERMINAL_EMULATOR: '',
      },
    },
  )
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Unable to read registry logger symbols')
  }
  const symbols = JSON.parse(result.stdout)
  return Object.fromEntries(
    Object.entries(symbols).map(([key, value]) => [
      key,
      stripVTControlCharacters(value as string),
    ]),
  ) as ReturnType<typeof getSymbols>
}

describe('Logger symbols on Windows', () => {
  it('uses fallback symbols for TERM=xterm', () => {
    expect(getSymbols('xterm')).toEqual({
      fail: '×',
      info: 'i',
      success: '√',
      warn: '‼',
    })
  })

  it('uses Unicode symbols for TERM=xterm-256color', () => {
    expect(getSymbols('xterm-256color')).toEqual({
      fail: '✖',
      info: 'ℹ',
      success: '✔',
      warn: '⚠',
    })
  })

  it('uses fallback symbols for unknown terminals', () => {
    expect(getSymbols('unknown')).toEqual({
      fail: '×',
      info: 'i',
      success: '√',
      warn: '‼',
    })
  })
})
