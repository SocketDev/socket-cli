import { describe, expect, it } from 'vitest'

import { resolveSocketApiTimeout } from '../../../../src/util/socket/api-timeout.mts'

describe('resolveSocketApiTimeout', () => {
  it('uses each caller fallback when configuration is unset', () => {
    expect(resolveSocketApiTimeout(Number.NaN, 30_000)).toBe(30_000)
    expect(resolveSocketApiTimeout(Number.NaN, 60_000)).toBe(60_000)
  })

  it('uses positive finite configured values', () => {
    expect(resolveSocketApiTimeout(15_000, 30_000)).toBe(15_000)
    expect(resolveSocketApiTimeout(90_000, 60_000)).toBe(90_000)
  })

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])(
    'uses the caller fallback for invalid configured value %s',
    configuredTimeout => {
      expect(resolveSocketApiTimeout(configuredTimeout, 30_000)).toBe(30_000)
    },
  )

  it('keeps an explicit override, including zero, ahead of configuration', () => {
    expect(resolveSocketApiTimeout(15_000, 30_000, 7000)).toBe(7000)
    expect(resolveSocketApiTimeout(15_000, 30_000, 0)).toBe(0)
  })

  it('does not coerce non-number configured values', () => {
    expect(resolveSocketApiTimeout('15000', 60_000)).toBe(60_000)
  })
})
