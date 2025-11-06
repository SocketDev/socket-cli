/**
 * @fileoverview Unit tests for text shimmer animation effect.
 *
 * Tests text shimmer animation utilities:
 * - applyShimmer() applies animated color gradient to text
 * - Direction modes: LTR, RTL, bidirectional, random, none
 * - CI detection: shimmer disabled in CI environments
 * - Color gradients: single color and multi-color gradient support
 * Used by Socket CLI for animated text effects in /ultrathink mode.
 */

import { stripAnsi } from '@socketsecurity/lib/ansi'
import { getCI } from '@socketsecurity/lib/env/ci'
import {
  applyShimmer,
  DIR_LTR,
  DIR_NONE,
  type ShimmerState,
} from '@socketsecurity/lib/effects/text-shimmer'
import { beforeEach, describe, expect, it } from 'vitest'

describe.sequential('text-shimmer', () => {
  describe.sequential('applyShimmer()', () => {
    let state: ShimmerState

    beforeEach(() => {
      state = {
        __proto__: null,
        currentDir: DIR_LTR,
        mode: DIR_LTR,
        speed: 1 / 3,
        step: 0,
      } as ShimmerState
    })

    describe('CI environment behavior', () => {
      it('should handle shimmer correctly in CI', () => {
        const text = 'Test text'
        const result = applyShimmer(text, state, {
          color: [140, 82, 255] as const,
          direction: DIR_LTR,
        })

        // Result should be colored
        const stripped = stripAnsi(result)
        expect(stripped).toBe(text)

        // Should contain color codes
        expect(result).toContain('\x1b[38;2;')
        expect(result).toContain('140;82;255')

        // In CI: step should not advance (shimmer disabled)
        // In non-CI: step should advance (shimmer enabled)
        if (getCI()) {
          expect(state.step).toBe(0)
        } else {
          expect(state.step).toBeGreaterThan(0)
        }
      })

      it('should handle all directions correctly in CI', () => {
        const text = 'Test'
        const directions = [DIR_LTR, 'rtl', 'bi', 'random'] as const

        for (const dir of directions) {
          const testState: ShimmerState = {
            currentDir: DIR_LTR,
            mode: DIR_LTR,
            speed: 1 / 3,
            step: 0,
          }

          const result = applyShimmer(text, testState, {
            color: [255, 0, 0] as const,
            direction: dir,
          })

          const stripped = stripAnsi(result)
          expect(stripped).toBe(text)

          // In CI: step should not advance (shimmer disabled)
          // In non-CI: step should advance (shimmer enabled)
          if (getCI()) {
            expect(testState.step).toBe(0)
          } else {
            expect(testState.step).toBeGreaterThan(0)
          }
        }
      })
    })

    describe('shimmer animation behavior', () => {
      it('should apply color and respect CI environment', () => {
        const text = 'Test'
        const result = applyShimmer(text, state, {
          color: [140, 82, 255] as const,
          direction: DIR_LTR,
        })

        // Result should contain ANSI color codes
        expect(result).toContain('\x1b[38;2;')
        // Result should have the original text when stripped
        expect(stripAnsi(result)).toBe(text)

        // In CI: step should not advance (shimmer disabled)
        // In non-CI: step should advance (shimmer enabled)
        if (getCI()) {
          expect(state.step).toBe(0)
        } else {
          expect(state.step).toBeGreaterThan(0)
        }
      })

      it('should animate shimmer position based on environment', () => {
        const text = 'Testing'
        const state1: ShimmerState = {
          currentDir: DIR_LTR,
          mode: DIR_LTR,
          speed: 1,
          step: 0,
        }

        const result1 = applyShimmer(text, state1, {
          color: [140, 82, 255] as const,
          direction: DIR_LTR,
        })

        if (getCI()) {
          // In CI: step should not advance (shimmer disabled)
          expect(state1.step).toBe(0)
        } else {
          // In non-CI: step should advance (shimmer enabled)
          expect(state1.step).toBe(1)

          const result2 = applyShimmer(text, state1, {
            color: [140, 82, 255] as const,
            direction: DIR_LTR,
          })

          // Step should advance again
          expect(state1.step).toBe(2)

          // Results should be different due to shimmer position change
          expect(result1).not.toBe(result2)
        }
      })
    })

    describe('direction modes', () => {
      it('should respect DIR_NONE and not apply shimmer', () => {
        const text = 'Test'
        const result = applyShimmer(text, state, {
          color: [140, 82, 255] as const,
          direction: DIR_NONE,
        })

        // Should be colored but state.step should not advance
        expect(state.step).toBe(0)
        expect(stripAnsi(result)).toBe(text)
      })

      it('should apply LTR direction shimmer based on environment', () => {
        const text = 'Test'
        const testState: ShimmerState = {
          currentDir: DIR_LTR,
          mode: DIR_LTR,
          speed: 1 / 3,
          step: 0,
        }

        const result = applyShimmer(text, testState, {
          color: [140, 82, 255] as const,
          direction: DIR_LTR,
        })

        expect(stripAnsi(result)).toBe(text)

        // In CI: step should not advance (shimmer disabled)
        // In non-CI: step should advance (shimmer enabled)
        if (getCI()) {
          expect(testState.step).toBe(0)
        } else {
          expect(testState.step).toBeGreaterThan(0)
        }
      })
    })

    describe('color options', () => {
      it('should apply single color to text', () => {
        const text = 'Test'
        const color: readonly [number, number, number] = [255, 0, 0] as const

        const result = applyShimmer(text, state, {
          color,
          direction: DIR_LTR,
        })

        // Should contain the red color code
        expect(result).toContain('\x1b[38;2;')
        expect(stripAnsi(result)).toBe(text)
      })

      it('should apply gradient colors to text', () => {
        const text = 'Test'
        const gradient: ReadonlyArray<readonly [number, number, number]> = [
          [255, 0, 0],
          [0, 255, 0],
          [0, 0, 255],
        ] as const

        const result = applyShimmer(text, state, {
          color: gradient,
          direction: DIR_LTR,
        })

        // Should contain color codes
        expect(result).toContain('\x1b[38;2;')
        expect(stripAnsi(result)).toBe(text)
      })
    })

    describe('edge cases', () => {
      it('should handle empty text', () => {
        const result = applyShimmer('', state, {
          color: [140, 82, 255] as const,
          direction: DIR_LTR,
        })

        expect(result).toBe('')
      })

      it('should preserve text content when shimmer is applied', () => {
        const texts = ['Simple', 'With Spaces', 'Special!@#$%']

        for (const text of texts) {
          const result = applyShimmer(text, state, {
            color: [140, 82, 255] as const,
            direction: DIR_LTR,
          })

          expect(stripAnsi(result)).toBe(text)
        }
      })
    })
  })
})
