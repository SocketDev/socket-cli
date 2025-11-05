/**
 * @fileoverview Unit tests for abort signal composition utilities.
 *
 * Tests AbortSignal composition and timeout utilities:
 * - createCompositeAbortSignal() combines multiple abort signals into one
 * - createTimeoutSignal() creates signal that aborts after timeout
 * - Signal lifecycle: abort propagation, event listeners, cleanup
 * - Edge cases: null signals, already-aborted signals, single signals
 * Used by Socket tools for cancellable async operations and timeout management.
 */

import {
  createCompositeAbortSignal,
  createTimeoutSignal,
} from '@socketsecurity/lib/abort'
import { describe, expect, it } from 'vitest'

describe('abort', () => {
  describe('createCompositeAbortSignal', () => {
    it('should return a new signal when no signals provided', () => {
      const signal = createCompositeAbortSignal()
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal.aborted).toBe(false)
    })

    it('should return a new signal when all signals are null', () => {
      const signal = createCompositeAbortSignal(null, null, undefined)
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal.aborted).toBe(false)
    })

    it('should return the same signal when only one valid signal provided', () => {
      const controller = new AbortController()
      const signal = createCompositeAbortSignal(controller.signal)
      expect(signal).toBe(controller.signal)
    })

    it('should return the same signal when one valid and others null', () => {
      const controller = new AbortController()
      const signal = createCompositeAbortSignal(
        null,
        controller.signal,
        undefined,
      )
      expect(signal).toBe(controller.signal)
    })

    it('should create composite signal from multiple signals', () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()
      const signal = createCompositeAbortSignal(
        controller1.signal,
        controller2.signal,
      )

      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal.aborted).toBe(false)
    })

    it('should abort composite signal when first signal aborts', async () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()
      const signal = createCompositeAbortSignal(
        controller1.signal,
        controller2.signal,
      )

      expect(signal.aborted).toBe(false)

      controller1.abort()

      // Wait for event propagation
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(signal.aborted).toBe(true)
    })

    it('should abort composite signal when second signal aborts', async () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()
      const signal = createCompositeAbortSignal(
        controller1.signal,
        controller2.signal,
      )

      expect(signal.aborted).toBe(false)

      controller2.abort()

      // Wait for event propagation
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(signal.aborted).toBe(true)
    })

    it('should return aborted signal if any input signal is already aborted', () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()

      controller1.abort()

      const signal = createCompositeAbortSignal(
        controller1.signal,
        controller2.signal,
      )

      expect(signal.aborted).toBe(true)
    })

    it('should handle mix of aborted and non-aborted signals', () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()

      controller2.abort()

      const signal = createCompositeAbortSignal(
        controller1.signal,
        controller2.signal,
      )

      expect(signal.aborted).toBe(true)
    })

    it('should handle many signals', async () => {
      const controllers = Array.from({ length: 5 }, () => new AbortController())
      const signal = createCompositeAbortSignal(
        ...controllers.map(c => c.signal),
      )

      expect(signal.aborted).toBe(false)

      controllers[3].abort()

      await new Promise(resolve => setTimeout(resolve, 0))

      expect(signal.aborted).toBe(true)
    })

    it('should handle many signals with nulls mixed in', async () => {
      const controllers = Array.from({ length: 3 }, () => new AbortController())
      const signal = createCompositeAbortSignal(
        null,
        controllers[0].signal,
        undefined,
        controllers[1].signal,
        null,
        controllers[2].signal,
      )

      expect(signal.aborted).toBe(false)

      controllers[1].abort()

      await new Promise(resolve => setTimeout(resolve, 0))

      expect(signal.aborted).toBe(true)
    })

    it('should return the single signal when only one valid signal among nulls', () => {
      const controller = new AbortController()
      const signal = createCompositeAbortSignal(
        null,
        null,
        controller.signal,
        undefined,
        null,
      )

      expect(signal).toBe(controller.signal)
    })

    it('should handle all aborted signals', () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()
      const controller3 = new AbortController()

      controller1.abort()
      controller2.abort()
      controller3.abort()

      const signal = createCompositeAbortSignal(
        controller1.signal,
        controller2.signal,
        controller3.signal,
      )

      expect(signal.aborted).toBe(true)
    })

    it('should handle first signal already aborted', () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()

      controller1.abort()

      const signal = createCompositeAbortSignal(
        controller1.signal,
        controller2.signal,
      )

      expect(signal.aborted).toBe(true)
    })

    it('should handle last signal already aborted', () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()
      const controller3 = new AbortController()

      controller3.abort()

      const signal = createCompositeAbortSignal(
        controller1.signal,
        controller2.signal,
        controller3.signal,
      )

      expect(signal.aborted).toBe(true)
    })

    it('should not abort if no source signals abort', async () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()
      const signal = createCompositeAbortSignal(
        controller1.signal,
        controller2.signal,
      )

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(signal.aborted).toBe(false)
    })

    it('should handle signal aborted multiple times', async () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()
      const signal = createCompositeAbortSignal(
        controller1.signal,
        controller2.signal,
      )

      controller1.abort()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(signal.aborted).toBe(true)

      // Abort again (should be idempotent)
      controller2.abort()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(signal.aborted).toBe(true)
    })
  })

  describe('createTimeoutSignal', () => {
    it('should create a signal that aborts after timeout', async () => {
      const signal = createTimeoutSignal(50)
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal.aborted).toBe(false)

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(signal.aborted).toBe(true)
    })

    it('should not abort before timeout', async () => {
      const signal = createTimeoutSignal(100)
      expect(signal.aborted).toBe(false)

      // Wait less than timeout
      await new Promise(resolve => setTimeout(resolve, 30))

      expect(signal.aborted).toBe(false)
    })

    it('should throw TypeError for non-number timeout', () => {
      expect(() => createTimeoutSignal('100' as any)).toThrow(TypeError)
      expect(() => createTimeoutSignal('100' as any)).toThrow(
        'timeout must be a number',
      )
    })

    it('should throw TypeError for NaN timeout', () => {
      expect(() => createTimeoutSignal(Number.NaN)).toThrow(TypeError)
      expect(() => createTimeoutSignal(Number.NaN)).toThrow(
        'timeout must be a number',
      )
    })

    it('should throw TypeError for infinite timeout', () => {
      expect(() => createTimeoutSignal(Number.POSITIVE_INFINITY)).toThrow(
        TypeError,
      )
      expect(() => createTimeoutSignal(Number.POSITIVE_INFINITY)).toThrow(
        'timeout must be a finite number',
      )
      expect(() => createTimeoutSignal(Number.NEGATIVE_INFINITY)).toThrow(
        TypeError,
      )
    })

    it('should throw TypeError for zero timeout', () => {
      expect(() => createTimeoutSignal(0)).toThrow(TypeError)
      expect(() => createTimeoutSignal(0)).toThrow(
        'timeout must be a positive number',
      )
    })

    it('should throw TypeError for negative timeout', () => {
      expect(() => createTimeoutSignal(-100)).toThrow(TypeError)
      expect(() => createTimeoutSignal(-100)).toThrow(
        'timeout must be a positive number',
      )
    })

    it('should handle very short timeouts', async () => {
      const signal = createTimeoutSignal(1)
      expect(signal.aborted).toBe(false)

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(signal.aborted).toBe(true)
    })

    it('should handle fractional timeouts', async () => {
      const signal = createTimeoutSignal(10.5)
      expect(signal.aborted).toBe(false)

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(signal.aborted).toBe(true)
    })

    it('should throw TypeError for null timeout', () => {
      expect(() => createTimeoutSignal(null as any)).toThrow(TypeError)
      expect(() => createTimeoutSignal(null as any)).toThrow(
        'timeout must be a number',
      )
    })

    it('should throw TypeError for undefined timeout', () => {
      expect(() => createTimeoutSignal(undefined as any)).toThrow(TypeError)
      expect(() => createTimeoutSignal(undefined as any)).toThrow(
        'timeout must be a number',
      )
    })

    it('should throw TypeError for object timeout', () => {
      expect(() => createTimeoutSignal({} as any)).toThrow(TypeError)
      expect(() => createTimeoutSignal({} as any)).toThrow(
        'timeout must be a number',
      )
    })

    it('should throw TypeError for array timeout', () => {
      expect(() => createTimeoutSignal([] as any)).toThrow(TypeError)
      expect(() => createTimeoutSignal([] as any)).toThrow(
        'timeout must be a number',
      )
    })

    it('should throw TypeError for boolean timeout', () => {
      expect(() => createTimeoutSignal(true as any)).toThrow(TypeError)
      expect(() => createTimeoutSignal(true as any)).toThrow(
        'timeout must be a number',
      )
    })

    it('should throw TypeError for negative infinity timeout', () => {
      expect(() => createTimeoutSignal(Number.NEGATIVE_INFINITY)).toThrow(
        TypeError,
      )
      expect(() => createTimeoutSignal(Number.NEGATIVE_INFINITY)).toThrow(
        'timeout must be a finite number',
      )
    })

    it('should handle medium timeouts', async () => {
      const signal = createTimeoutSignal(50)
      expect(signal.aborted).toBe(false)

      await new Promise(resolve => setTimeout(resolve, 70))

      expect(signal.aborted).toBe(true)
    })

    it('should create independent signals', async () => {
      const signal1 = createTimeoutSignal(50)
      const signal2 = createTimeoutSignal(150)

      expect(signal1.aborted).toBe(false)
      expect(signal2.aborted).toBe(false)

      await new Promise(resolve => setTimeout(resolve, 70))

      expect(signal1.aborted).toBe(true)
      expect(signal2.aborted).toBe(false)

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(signal2.aborted).toBe(true)
    })
  })
})
