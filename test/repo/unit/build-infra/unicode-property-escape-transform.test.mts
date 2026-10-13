import { runInNewContext } from 'node:vm'

import { describe, expect, test } from 'vitest'

import {
  transformRegexPattern,
  transformUnicodePropertyEscapes,
} from '../../../../scripts/repo/build-infra/unicode-property-escape-transform.mts'

describe('Unicode property escape transform', () => {
  test('replaces positive escapes outside a character class', () => {
    const pattern = transformRegexPattern(String.raw`\p{L}+`)
    expect(new RegExp(`^${pattern}$`).test('force')).toBe(true)
    expect(new RegExp(`^${pattern}$`).test('123')).toBe(false)
  })

  test('flattens adjacent positive escapes inside a character class', () => {
    const pattern = transformRegexPattern(
      String.raw`^[\p{L}\p{N}][\p{L}\p{N}'’-]*$`,
    )
    const expression = new RegExp(pattern)
    expect(expression.test('force')).toBe(true)
    expect(expression.test('abc123')).toBe(true)
    expect(expression.test('abc!')).toBe(false)
  })

  test('keeps a negated outer class valid', () => {
    const expression = new RegExp(
      transformRegexPattern(String.raw`^[^\p{L}]+$`),
    )
    expect(expression.test('123')).toBe(true)
    expect(expression.test('letters')).toBe(false)
  })

  test('does not transform escaped brackets or backslashes', () => {
    expect(transformRegexPattern(String.raw`\\p{L}`)).toBe(String.raw`\\p{L}`)
    expect(transformRegexPattern(String.raw`\[abc\]`)).toBe(String.raw`\[abc\]`)
    const escapedBracket = new RegExp(
      transformRegexPattern(String.raw`\[\p{L}+\]`),
    )
    expect(escapedBracket.test('[abc]')).toBe(true)
  })

  test('leaves unknown and negative properties unchanged', () => {
    expect(transformRegexPattern(String.raw`\p{Unknown}`)).toBe(
      String.raw`\p{Unknown}`,
    )
    expect(transformRegexPattern(String.raw`\P{L}`)).toBe(String.raw`\P{L}`)
  })

  test('transforms regex literals and RegExp constructor strings', () => {
    const source = String.raw`
      const literal = /^[\p{L}\p{N}]+$/u
      const constructor = new RegExp("^[\\p{L}\\p{N}]+$", "u")
    `
    const transformed = transformUnicodePropertyEscapes(source)
    const [literal, constructor] = runInNewContext(
      `${transformed}; [literal, constructor]`,
    ) as [RegExp, RegExp]
    expect(literal.test('force123')).toBe(true)
    expect(constructor.test('force123')).toBe(true)
  })
})
