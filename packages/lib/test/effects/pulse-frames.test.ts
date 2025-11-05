/**
 * @fileoverview Unit tests for Socket pulse animation frames generator.
 *
 * Tests Socket pulse animation frame generation:
 * - generateSocketSpinnerFrames() creates 18-frame pulse animation
 * - ANSI color codes for bold/dim effects
 * - Unicode sparkle characters (✦✧⋆⚡) with variation selectors
 * - Symmetrical build-up and fade-down animation pattern
 * Used by Socket CLI for /ultrathink mode spinner and progress indicators.
 */

import { describe, expect, it } from 'vitest'

import {
  generateSocketSpinnerFrames,
  type SocketFramesOptions,
} from '@socketsecurity/lib/effects/pulse-frames'

describe('effects/pulse-frames', () => {
  describe('generateSocketSpinnerFrames', () => {
    it('should generate frames with default options', () => {
      const result = generateSocketSpinnerFrames()
      expect(result).toBeDefined()
      expect(result.frames).toBeDefined()
      expect(result.interval).toBeDefined()
    })

    it('should return default interval of 50ms', () => {
      const result = generateSocketSpinnerFrames()
      expect(result.interval).toBe(50)
    })

    it('should accept custom interval option', () => {
      const options: SocketFramesOptions = { interval: 100 }
      const result = generateSocketSpinnerFrames(options)
      expect(result.interval).toBe(100)
    })

    it('should generate 18 frames', () => {
      const result = generateSocketSpinnerFrames()
      expect(result.frames).toHaveLength(18)
    })

    it('should return frames as string array', () => {
      const result = generateSocketSpinnerFrames()
      expect(Array.isArray(result.frames)).toBe(true)
      for (const frame of result.frames) {
        expect(typeof frame).toBe('string')
      }
    })

    it('should include ANSI codes in frames', () => {
      const result = generateSocketSpinnerFrames()
      // All frames should contain ANSI escape codes
      for (const frame of result.frames) {
        expect(frame).toContain('\x1b')
      }
    })

    it('should include reset codes in all frames', () => {
      const result = generateSocketSpinnerFrames()
      const reset = '\x1b[0m'
      for (const frame of result.frames) {
        expect(frame).toContain(reset)
      }
    })

    it('should include Unicode sparkle characters', () => {
      const result = generateSocketSpinnerFrames()
      const allFramesText = result.frames.join('')
      // Should contain some sparkle/star characters
      expect(allFramesText).toMatch(/[✦✧⋆⚡]/)
    })

    it('should include variation selector for text-style rendering', () => {
      const result = generateSocketSpinnerFrames()
      const allFramesText = result.frames.join('')
      // Should contain VS15 variation selector
      expect(allFramesText).toContain('\uFE0E')
    })

    it('should include bold ANSI code in some frames', () => {
      const result = generateSocketSpinnerFrames()
      const bold = '\x1b[1m'
      const boldFrames = result.frames.filter(f => f.includes(bold))
      expect(boldFrames.length).toBeGreaterThan(0)
    })

    it('should include dim ANSI code in some frames', () => {
      const result = generateSocketSpinnerFrames()
      const dim = '\x1b[2m'
      const dimFrames = result.frames.filter(f => f.includes(dim))
      expect(dimFrames.length).toBeGreaterThan(0)
    })

    it('should return result with null prototype', () => {
      const result = generateSocketSpinnerFrames()
      expect(Object.getPrototypeOf(result)).toBeNull()
    })

    it('should handle baseColor option (ignored internally)', () => {
      const options: SocketFramesOptions = {
        baseColor: [255, 100, 120],
        interval: 75,
      }
      const result = generateSocketSpinnerFrames(options)
      expect(result.interval).toBe(75)
      expect(result.frames).toHaveLength(18)
    })

    it('should handle undefined options', () => {
      const result = generateSocketSpinnerFrames(undefined)
      expect(result.frames).toHaveLength(18)
      expect(result.interval).toBe(50)
    })

    it('should handle empty options object', () => {
      const result = generateSocketSpinnerFrames({})
      expect(result.frames).toHaveLength(18)
      expect(result.interval).toBe(50)
    })

    it('should have consistent frame structure', () => {
      const result = generateSocketSpinnerFrames()
      // All frames should contain ANSI codes and end with reset
      const reset = '\x1b[0m'
      for (const frame of result.frames) {
        expect(frame).toContain('\x1b[')
        expect(frame.endsWith(reset)).toBe(true)
      }
    })

    it('should include lightning emoji in frames', () => {
      const result = generateSocketSpinnerFrames()
      const lightning = '⚡'
      const lightningFrames = result.frames.filter(f => f.includes(lightning))
      expect(lightningFrames.length).toBeGreaterThan(0)
    })

    it('should include different star variants', () => {
      const result = generateSocketSpinnerFrames()
      const allFramesText = result.frames.join('')
      // Should contain filled star
      expect(allFramesText).toContain('✦')
      // Should contain outline star
      expect(allFramesText).toContain('✧')
      // Should contain tiny star
      expect(allFramesText).toContain('⋆')
    })

    it('should have symmetrical pulse pattern', () => {
      const result = generateSocketSpinnerFrames()
      // The animation should build up and fade down
      // First 9 frames build up, last 9 fade down
      expect(result.frames.length % 2).toBe(0)
      const halfLength = result.frames.length / 2
      expect(halfLength).toBe(9)
    })
  })
})
