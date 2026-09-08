/**
 * Unit tests for output mode detection.
 *
 * Purpose: Tests output mode detection and selection. Validates detection of
 * text, json, and markdown modes.
 *
 * Test Coverage: - Output mode parsing - Default mode selection - TTY
 * detection.
 *
 * - CI environment detection - Mode validation.
 *
 * Testing Approach: Tests output mode selection logic based on environment.
 *
 * Related Files: - util/output/mode.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  getOutputKind,
  isMachineOutputMode,
  SENTINEL_BEGIN,
  SENTINEL_END,
} from '../../../../src/util/output/mode.mts'

describe('getOutputKind', () => {
  it("returns 'json' when json flag is truthy", () => {
    expect(getOutputKind(true, false)).toBe('json')
    expect(getOutputKind(1, false)).toBe('json')
    expect(getOutputKind('yes', false)).toBe('json')
    expect(getOutputKind({}, false)).toBe('json')
    expect(getOutputKind([], false)).toBe('json')
  })

  it("returns 'json' even when both json and markdown are truthy (json takes precedence)", () => {
    expect(getOutputKind(true, true)).toBe('json')
    expect(getOutputKind(1, 1)).toBe('json')
    expect(getOutputKind('json', 'markdown')).toBe('json')
  })

  it('returns markdown output kind when markdown flag is truthy and json is falsy', () => {
    expect(getOutputKind(false, true)).toBe('markdown')
    expect(getOutputKind(undefined, true)).toBe('markdown')
    expect(getOutputKind(undefined, true)).toBe('markdown')
    expect(getOutputKind(0, true)).toBe('markdown')
    expect(getOutputKind('', true)).toBe('markdown')
    expect(getOutputKind(false, 'markdown')).toBe('markdown')
    expect(getOutputKind(false, 1)).toBe('markdown')
    expect(getOutputKind(false, {})).toBe('markdown')
  })

  it('returns text output kind when both flags are falsy', () => {
    expect(getOutputKind(false, false)).toBe('text')
    expect(getOutputKind(undefined, undefined)).toBe('text')
    expect(getOutputKind(undefined, undefined)).toBe('text')
    expect(getOutputKind(0, 0)).toBe('text')
    expect(getOutputKind('', '')).toBe('text')
    expect(getOutputKind(undefined, false)).toBe('text')
    expect(getOutputKind(undefined, undefined)).toBe('text')
  })

  it('handles edge cases with special values', () => {
    expect(getOutputKind(Number.NaN, false)).toBe('text')
    expect(getOutputKind(false, Number.NaN)).toBe('text')
    expect(getOutputKind(Number.NaN, Number.NaN)).toBe('text')
  })

  it('follows JavaScript truthy/falsy rules', () => {
    // Truthy values.
    expect(getOutputKind(true, false)).toBe('json')
    expect(getOutputKind('a', false)).toBe('json')
    expect(getOutputKind(42, false)).toBe('json')
    expect(getOutputKind(-1, false)).toBe('json')
    expect(getOutputKind(Number.POSITIVE_INFINITY, false)).toBe('json')
    expect(getOutputKind([], false)).toBe('json')
    expect(getOutputKind({}, false)).toBe('json')
    expect(getOutputKind(() => {}, false)).toBe('json')

    // Falsy values.
    expect(getOutputKind(false, false)).toBe('text')
    expect(getOutputKind(0, false)).toBe('text')
    expect(getOutputKind(-0, false)).toBe('text')
    expect(getOutputKind(0n, false)).toBe('text')
    expect(getOutputKind('', false)).toBe('text')
    expect(getOutputKind(undefined, false)).toBe('text')
    expect(getOutputKind(undefined, false)).toBe('text')
    expect(getOutputKind(Number.NaN, false)).toBe('text')
  })
})

describe('isMachineOutputMode', () => {
  it('returns true for --json', () => {
    expect(isMachineOutputMode({ json: true })).toBe(true)
  })

  it('returns true for --markdown', () => {
    expect(isMachineOutputMode({ markdown: true })).toBe(true)
  })

  it('returns true for --quiet', () => {
    expect(isMachineOutputMode({ quiet: true })).toBe(true)
  })

  it('returns true when multiple machine-mode flags are set', () => {
    expect(isMachineOutputMode({ json: true, quiet: true })).toBe(true)
    expect(
      isMachineOutputMode({ json: true, markdown: true, quiet: true }),
    ).toBe(true)
  })

  it('returns false when no machine-mode flag is set', () => {
    expect(isMachineOutputMode({})).toBe(false)
    expect(
      isMachineOutputMode({
        json: false,
        markdown: false,
        quiet: false,
      }),
    ).toBe(false)
    expect(
      isMachineOutputMode({
        json: undefined,
        markdown: undefined,
        quiet: undefined,
      }),
    ).toBe(false)
  })
})

describe('SENTINEL constants', () => {
  it('uses NUL bytes so sentinels never appear in legitimate JSON', () => {
    expect(SENTINEL_BEGIN.startsWith('\u0000')).toBe(true)
    expect(SENTINEL_BEGIN.endsWith('\u0000')).toBe(true)
    expect(SENTINEL_END.startsWith('\u0000')).toBe(true)
    expect(SENTINEL_END.endsWith('\u0000')).toBe(true)
  })

  it('uses distinct BEGIN and END markers', () => {
    expect(SENTINEL_BEGIN === SENTINEL_END).toBe(false)
  })
})
