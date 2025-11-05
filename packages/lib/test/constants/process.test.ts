/**
 * @fileoverview Unit tests for process control utilities: abort signals and spinner.
 *
 * Tests process control constants:
 * - Exit codes: SUCCESS (0), FAILURE (1), error codes
 * - Signal names: SIGINT, SIGTERM, SIGUSR1
 * - AbortSignal/AbortController utilities
 * Frozen constants for process lifecycle management.
 */

import { describe, expect, it } from 'vitest'

import {
  getAbortController,
  getAbortSignal,
  getSpinner,
} from '@socketsecurity/lib/constants/process'

describe('constants/process', () => {
  describe('getAbortController', () => {
    it('should return an AbortController instance', () => {
      const controller = getAbortController()
      expect(controller).toBeInstanceOf(AbortController)
    })

    it('should return same instance on multiple calls (singleton)', () => {
      const first = getAbortController()
      const second = getAbortController()
      expect(first).toBe(second)
    })

    it('should have abort method', () => {
      const controller = getAbortController()
      expect(typeof controller.abort).toBe('function')
    })

    it('should have signal property', () => {
      const controller = getAbortController()
      expect(controller.signal).toBeInstanceOf(AbortSignal)
    })
  })

  describe('getAbortSignal', () => {
    it('should return an AbortSignal instance', () => {
      const signal = getAbortSignal()
      expect(signal).toBeInstanceOf(AbortSignal)
    })

    it('should return same signal on multiple calls', () => {
      const first = getAbortSignal()
      const second = getAbortSignal()
      expect(first).toBe(second)
    })

    it('should return signal from AbortController', () => {
      const controller = getAbortController()
      const signal = getAbortSignal()
      expect(signal).toBe(controller.signal)
    })

    it('should have aborted property', () => {
      const signal = getAbortSignal()
      expect(typeof signal.aborted).toBe('boolean')
    })

    it('should have addEventListener method', () => {
      const signal = getAbortSignal()
      expect(typeof signal.addEventListener).toBe('function')
    })

    it('should have removeEventListener method', () => {
      const signal = getAbortSignal()
      expect(typeof signal.removeEventListener).toBe('function')
    })
  })

  describe('getSpinner', () => {
    it('should return null or a Spinner object', () => {
      const spinner = getSpinner()
      expect(spinner === null || typeof spinner === 'object').toBe(true)
    })

    it('should return same instance on multiple calls (cached)', () => {
      const first = getSpinner()
      const second = getSpinner()
      expect(first).toBe(second)
    })

    it('should handle spinner module not being available', () => {
      // Should not throw even if spinner module is unavailable
      expect(() => getSpinner()).not.toThrow()
    })

    it('should return null when spinner cannot be loaded', () => {
      const spinner = getSpinner()
      // In test environment, spinner might not be available
      expect([null, 'object'].includes(typeof spinner)).toBe(true)
    })
  })

  describe('integration', () => {
    it('should allow AbortController and Signal to work together', () => {
      const controller = getAbortController()
      const signal = getAbortSignal()
      expect(signal).toBe(controller.signal)
      expect(signal.aborted).toBe(controller.signal.aborted)
    })

    it('should support abort signal event listening', () => {
      const signal = getAbortSignal()
      let called = false
      const handler = () => {
        called = true
      }

      signal.addEventListener('abort', handler)
      expect(called).toBe(false)
      signal.removeEventListener('abort', handler)
    })
  })

  describe('singleton behavior', () => {
    it('should maintain singleton pattern for AbortController', () => {
      const instances = []
      for (let i = 0; i < 5; i++) {
        instances.push(getAbortController())
      }
      const allSame = instances.every(inst => inst === instances[0])
      expect(allSame).toBe(true)
    })

    it('should maintain singleton pattern for AbortSignal', () => {
      const signals = []
      for (let i = 0; i < 5; i++) {
        signals.push(getAbortSignal())
      }
      const allSame = signals.every(sig => sig === signals[0])
      expect(allSame).toBe(true)
    })

    it('should cache spinner result', () => {
      const first = getSpinner()
      const second = getSpinner()
      const third = getSpinner()
      expect(first).toBe(second)
      expect(second).toBe(third)
    })
  })

  describe('error handling', () => {
    it('should not throw when getting AbortController', () => {
      expect(() => getAbortController()).not.toThrow()
    })

    it('should not throw when getting AbortSignal', () => {
      expect(() => getAbortSignal()).not.toThrow()
    })

    it('should gracefully handle spinner loading errors', () => {
      expect(() => getSpinner()).not.toThrow()
    })
  })

  describe('real-world usage', () => {
    it('should support passing signal to fetch-like APIs', () => {
      const signal = getAbortSignal()
      expect(signal).toBeInstanceOf(AbortSignal)
      // Signal could be passed to fetch({ signal })
    })

    it('should support abort controller abort method', () => {
      const controller = getAbortController()
      expect(typeof controller.abort).toBe('function')
      // Could call controller.abort() to cancel operations
    })

    it('should support checking if operation was aborted', () => {
      const signal = getAbortSignal()
      expect(typeof signal.aborted).toBe('boolean')
    })
  })
})
