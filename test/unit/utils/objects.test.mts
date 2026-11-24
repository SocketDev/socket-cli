import { describe, expect, it } from 'vitest'

import { toSortedObject } from '../../../src/utils/objects.mts'

describe('toSortedObject', () => {
  it('returns an empty object when given no entries', () => {
    const result = toSortedObject({})

    expect(result).toEqual({})
    expect(Array.isArray(result)).toBe(false)
    expect(JSON.stringify(result)).toBe('{}')
  })
})
