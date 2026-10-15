import { describe, expect, it } from 'vitest'

import { resolveConfiguredSocketApiTimeout } from './api.mts'

describe('resolveConfiguredSocketApiTimeout', () => {
  it('keeps finite positive configured values', () => {
    expect(resolveConfiguredSocketApiTimeout(250)).toBe(250)
    expect(resolveConfiguredSocketApiTimeout(90_000)).toBe(90_000)
  })

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('omits invalid configured value %s', timeout => {
    expect(resolveConfiguredSocketApiTimeout(timeout)).toBeUndefined()
  })
})
