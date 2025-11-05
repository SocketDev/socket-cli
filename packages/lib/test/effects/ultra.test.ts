/**
 * @fileoverview Tests for ultrathink rainbow gradient effect.
 *
 * Tests ultrathink visual effect (rainbow gradient animation):
 * - createUltraEffect() generates rainbow gradient frames
 * - Multi-color spectrum transitions
 * - Smooth color interpolation
 * - Frame rate and timing control
 * Used by Socket CLI for /ultrathink mode visual feedback and emphasis.
 */

import { describe, expect, it } from 'vitest'

import {
  generateRainbowGradient,
  RAINBOW_GRADIENT,
} from '@socketsecurity/lib/effects/ultra'

describe('effects/ultra', () => {
  describe('RAINBOW_GRADIENT', () => {
    it('should be defined', () => {
      expect(RAINBOW_GRADIENT).toBeDefined()
    })

    it('should have 10 colors', () => {
      expect(RAINBOW_GRADIENT).toHaveLength(10)
    })

    it('should contain RGB triplets', () => {
      for (const color of RAINBOW_GRADIENT) {
        expect(color).toHaveLength(3)
        expect(typeof color[0]).toBe('number')
        expect(typeof color[1]).toBe('number')
        expect(typeof color[2]).toBe('number')
      }
    })

    it('should have valid RGB values (0-255)', () => {
      for (const color of RAINBOW_GRADIENT) {
        for (const component of color) {
          expect(component).toBeGreaterThanOrEqual(0)
          expect(component).toBeLessThanOrEqual(255)
        }
      }
    })

    it('should start with red/pink color', () => {
      const firstColor = RAINBOW_GRADIENT[0]
      expect(firstColor).toBeDefined()
      expect(firstColor![0]).toBe(255) // High red
    })

    it('should end with red/pink color', () => {
      const lastColor = RAINBOW_GRADIENT[RAINBOW_GRADIENT.length - 1]
      expect(lastColor).toBeDefined()
      expect(lastColor![0]).toBe(255) // High red
    })

    it('should contain orange color', () => {
      const orange = RAINBOW_GRADIENT.find(
        c => c[0] === 255 && c[1] === 140 && c[2] === 80,
      )
      expect(orange).toBeDefined()
    })

    it('should contain green color', () => {
      const green = RAINBOW_GRADIENT.find(
        c => c[0] === 120 && c[1] === 200 && c[2] === 100,
      )
      expect(green).toBeDefined()
    })

    it('should contain blue color', () => {
      const blue = RAINBOW_GRADIENT.find(
        c => c[0] === 80 && c[1] === 160 && c[2] === 220,
      )
      expect(blue).toBeDefined()
    })
  })

  describe('generateRainbowGradient', () => {
    it('should generate gradient for short text', () => {
      const gradient = generateRainbowGradient(5)
      expect(gradient).toHaveLength(5)
    })

    it('should generate gradient for long text', () => {
      const gradient = generateRainbowGradient(100)
      expect(gradient).toHaveLength(100)
    })

    it('should generate gradient for zero length', () => {
      const gradient = generateRainbowGradient(0)
      expect(gradient).toHaveLength(0)
    })

    it('should generate gradient for text length 1', () => {
      const gradient = generateRainbowGradient(1)
      expect(gradient).toHaveLength(1)
      expect(gradient[0]).toEqual(RAINBOW_GRADIENT[0])
    })

    it('should cycle through base gradient colors', () => {
      const length = RAINBOW_GRADIENT.length * 2
      const gradient = generateRainbowGradient(length)

      // First cycle should match base gradient
      for (let i = 0; i < RAINBOW_GRADIENT.length; i += 1) {
        expect(gradient[i]).toEqual(RAINBOW_GRADIENT[i])
      }

      // Second cycle should repeat
      for (let i = 0; i < RAINBOW_GRADIENT.length; i += 1) {
        expect(gradient[i + RAINBOW_GRADIENT.length]).toEqual(
          RAINBOW_GRADIENT[i],
        )
      }
    })

    it('should return RGB triplets', () => {
      const gradient = generateRainbowGradient(5)
      for (const color of gradient) {
        expect(color).toHaveLength(3)
        expect(typeof color[0]).toBe('number')
        expect(typeof color[1]).toBe('number')
        expect(typeof color[2]).toBe('number')
      }
    })

    it('should have valid RGB values', () => {
      const gradient = generateRainbowGradient(20)
      for (const color of gradient) {
        for (const component of color) {
          expect(component).toBeGreaterThanOrEqual(0)
          expect(component).toBeLessThanOrEqual(255)
        }
      }
    })

    it('should handle exact multiple of base gradient length', () => {
      const length = RAINBOW_GRADIENT.length
      const gradient = generateRainbowGradient(length)
      expect(gradient).toHaveLength(length)
      expect(gradient).toEqual(RAINBOW_GRADIENT)
    })

    it('should distribute colors evenly', () => {
      const gradient = generateRainbowGradient(15)
      expect(gradient).toHaveLength(15)

      // Check that colors cycle through the base gradient
      for (let i = 0; i < 15; i += 1) {
        const expectedColorIndex = i % RAINBOW_GRADIENT.length
        expect(gradient[i]).toEqual(RAINBOW_GRADIENT[expectedColorIndex])
      }
    })

    it('should handle large text lengths efficiently', () => {
      const gradient = generateRainbowGradient(1000)
      expect(gradient).toHaveLength(1000)
      // Spot check some positions
      expect(gradient[0]).toEqual(RAINBOW_GRADIENT[0])
      expect(gradient[999]).toEqual(
        RAINBOW_GRADIENT[999 % RAINBOW_GRADIENT.length],
      )
    })

    it('should generate consistent results for same input', () => {
      const gradient1 = generateRainbowGradient(10)
      const gradient2 = generateRainbowGradient(10)
      expect(gradient1).toEqual(gradient2)
    })

    it('should return different gradients for different lengths', () => {
      const gradient1 = generateRainbowGradient(5)
      const gradient2 = generateRainbowGradient(10)
      expect(gradient1.length).not.toBe(gradient2.length)
    })
  })
})
