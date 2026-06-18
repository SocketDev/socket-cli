import { describe, expect, it } from 'vitest'

import {
  isOmittedReachValue,
  isValidReachAnalysisMemoryLimit,
  isValidReachAnalysisTimeout,
  reachMemoryLimitToMb,
} from './reachability-units.mts'

describe('isValidReachAnalysisTimeout', () => {
  // Units are case-insensitive, matching Coana.
  it.each(['', '0', '90', '90s', '10m', '1h', '600', '10M', '1H', '30S'])(
    'accepts %j',
    value => {
      expect(isValidReachAnalysisTimeout(value)).toBe(true)
    },
  )

  it.each(['90ms', '1.5h', '10 m', 'm', '-1', 'invalid', '10mb'])(
    'rejects %j',
    value => {
      expect(isValidReachAnalysisTimeout(value)).toBe(false)
    },
  )
})

describe('isValidReachAnalysisMemoryLimit', () => {
  // Units are case-insensitive, matching Coana.
  it.each(['', '0', '8192', '512MB', '512mb', '8GB', '8gb', '8Gb'])(
    'accepts %j',
    value => {
      expect(isValidReachAnalysisMemoryLimit(value)).toBe(true)
    },
  )

  it.each(['512kb', '1TB', '1.5GB', '8 GB', 'GB', '-1', 'invalid'])(
    'rejects %j',
    value => {
      expect(isValidReachAnalysisMemoryLimit(value)).toBe(false)
    },
  )
})

describe('isOmittedReachValue', () => {
  // Empty or any zero-magnitude value means "use the default" (flag omitted).
  it.each(['', '0', '00', '0s', '0m', '0h', '0mb', '0gb'])(
    'treats %j as omitted',
    value => {
      expect(isOmittedReachValue(value)).toBe(true)
    },
  )

  it.each(['90s', '10m', '8192', '8GB', '1'])('forwards %j', value => {
    expect(isOmittedReachValue(value)).toBe(false)
  })
})

describe('reachMemoryLimitToMb', () => {
  it.each([
    { 0: '8192', 1: 8192 },
    { 0: '8192MB', 1: 8192 },
    { 0: '8192mb', 1: 8192 },
    { 0: '8GB', 1: 8192 },
    { 0: '8gb', 1: 8192 },
    { 0: '512MB', 1: 512 },
    { 0: '1', 1: 1 },
  ])('resolves $0 to $1 MB', ({ 0: value, 1: expected }) => {
    expect(reachMemoryLimitToMb(value)).toBe(expected)
  })

  it.each(['', '0', '0mb', '0gb', 'invalid'])(
    'returns null for omitted/unparseable %j',
    value => {
      expect(reachMemoryLimitToMb(value)).toBeNull()
    },
  )
})
