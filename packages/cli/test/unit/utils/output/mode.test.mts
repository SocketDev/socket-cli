import { describe, expect, it } from 'vitest'

import {
  OUTPUT_JSON,
  OUTPUT_MARKDOWN,
  OUTPUT_TEXT,
} from '../../../../src/constants/cli.mts'
import { getOutputKind } from '../../../../../src/utils/output/mode.mts'

describe('getOutputKind', () => {
  it('returns OUTPUT_JSON when json flag is truthy', () => {
    expect(getOutputKind(true, false)).toBe(OUTPUT_JSON)
    expect(getOutputKind(1, false)).toBe(OUTPUT_JSON)
    expect(getOutputKind('yes', false)).toBe(OUTPUT_JSON)
    expect(getOutputKind({}, false)).toBe(OUTPUT_JSON)
    expect(getOutputKind([], false)).toBe(OUTPUT_JSON)
  })

  it('returns OUTPUT_JSON even when both json and markdown are truthy (json takes precedence)', () => {
    expect(getOutputKind(true, true)).toBe(OUTPUT_JSON)
    expect(getOutputKind(1, 1)).toBe(OUTPUT_JSON)
    expect(getOutputKind('json', 'markdown')).toBe(OUTPUT_JSON)
  })

  it('returns OUTPUT_MARKDOWN when markdown flag is truthy and json is falsy', () => {
    expect(getOutputKind(false, true)).toBe(OUTPUT_MARKDOWN)
    expect(getOutputKind(null, true)).toBe(OUTPUT_MARKDOWN)
    expect(getOutputKind(undefined, true)).toBe(OUTPUT_MARKDOWN)
    expect(getOutputKind(0, true)).toBe(OUTPUT_MARKDOWN)
    expect(getOutputKind('', true)).toBe(OUTPUT_MARKDOWN)
    expect(getOutputKind(false, 'markdown')).toBe(OUTPUT_MARKDOWN)
    expect(getOutputKind(false, 1)).toBe(OUTPUT_MARKDOWN)
    expect(getOutputKind(false, {})).toBe(OUTPUT_MARKDOWN)
  })

  it('returns OUTPUT_TEXT when both flags are falsy', () => {
    expect(getOutputKind(false, false)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(null, null)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(undefined, undefined)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(0, 0)).toBe(OUTPUT_TEXT)
    expect(getOutputKind('', '')).toBe(OUTPUT_TEXT)
    expect(getOutputKind(null, false)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(undefined, null)).toBe(OUTPUT_TEXT)
  })

  it('handles edge cases with special values', () => {
    expect(getOutputKind(Number.NaN, false)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(false, Number.NaN)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(Number.NaN, Number.NaN)).toBe(OUTPUT_TEXT)
  })

  it('follows JavaScript truthy/falsy rules', () => {
    // Truthy values.
    expect(getOutputKind(true, false)).toBe(OUTPUT_JSON)
    expect(getOutputKind('a', false)).toBe(OUTPUT_JSON)
    expect(getOutputKind(42, false)).toBe(OUTPUT_JSON)
    expect(getOutputKind(-1, false)).toBe(OUTPUT_JSON)
    expect(getOutputKind(Number.POSITIVE_INFINITY, false)).toBe(OUTPUT_JSON)
    expect(getOutputKind([], false)).toBe(OUTPUT_JSON)
    expect(getOutputKind({}, false)).toBe(OUTPUT_JSON)
    expect(getOutputKind(() => {}, false)).toBe(OUTPUT_JSON)

    // Falsy values.
    expect(getOutputKind(false, false)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(0, false)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(-0, false)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(0n, false)).toBe(OUTPUT_TEXT)
    expect(getOutputKind('', false)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(null, false)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(undefined, false)).toBe(OUTPUT_TEXT)
    expect(getOutputKind(Number.NaN, false)).toBe(OUTPUT_TEXT)
  })
})
