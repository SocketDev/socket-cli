import { describe, expect, expectTypeOf, it } from 'vitest'

import { isFlagName } from '../../../../src/util/cli/flag-name.mts'

import type { FlagName } from '../../../../src/util/cli/flag-name.mts'

describe('flag names', () => {
  it.each(['camelCase', 'kebab-case', 'Help', 'version2'])(
    'accepts %s',
    value => {
      expect(isFlagName(value)).toBe(true)
    },
  )

  it.each(['', '2version', '-help', '_private', '.config', 'éxample'])(
    'rejects %s',
    value => {
      expect(isFlagName(value)).toBe(false)
    },
  )

  it('narrows validated input to the public flag domain', () => {
    const value: string = 'dryRun'
    if (!isFlagName(value)) {
      throw new Error('Expected a valid fixture flag')
    }
    expectTypeOf(value).toEqualTypeOf<FlagName>()
    expectTypeOf<'dryRun'>().toExtend<FlagName>()
    expectTypeOf<'dry-run'>().toExtend<FlagName>()
    expectTypeOf<'9run'>().not.toExtend<FlagName>()
    expectTypeOf<'-run'>().not.toExtend<FlagName>()
  })
})
