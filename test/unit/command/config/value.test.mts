import { describe, expect, it } from 'vitest'

import { configValueText } from '../../../../src/command/config/value.mts'

describe('config value text', () => {
  it.each([
    ['configured', 'configured'],
    [true, 'true'],
    [false, 'false'],
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- JSON config null must remain distinct from a missing value.
    [null, 'null'],
    [undefined, 'undefined'],
    [['first', 'second'], 'first,second'],
    [[], ''],
  ] as const)(
    'preserves primitive and array output for %j',
    (value, expected) => {
      expect(configValueText(value)).toBe(expected)
    },
  )

  it('does not expand OAuth session fields into text output', () => {
    expect(
      configValueText({
        clientId: 'example-client',
        issuer: 'https://example.com',
      }),
    ).toBe('[object Object]')
  })
})
