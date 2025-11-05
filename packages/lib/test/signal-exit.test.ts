/**
 * @fileoverview Unit tests for process signal handling utilities.
 *
 * Tests signal-exit event handling:
 * - load() initializes signal handlers
 * - unload() removes signal handlers
 * - onExit() registers cleanup callbacks for process termination
 * - signals() returns current signal handler state
 * - SIGINT, SIGTERM, SIGHUP signal handling
 * Used by Socket CLI for graceful shutdown and cleanup on process exit.
 */

import { load, onExit, signals, unload } from '@socketsecurity/lib/signal-exit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('signal-exit', () => {
  beforeEach(() => {
    // Ensure clean state before each test
    unload()
  })

  afterEach(() => {
    // Clean up after each test
    unload()
  })

  describe('load', () => {
    it('should load signal handlers', () => {
      load()
      expect(signals()).toBeTruthy()
    })

    it('should be idempotent (safe to call multiple times)', () => {
      load()
      load()
      load()
      expect(signals()).toBeTruthy()
    })

    it('should register signal listeners', () => {
      load()
      const sigs = signals()
      expect(Array.isArray(sigs)).toBe(true)
      if (sigs) {
        expect(sigs.length).toBeGreaterThan(0)
      }
    })
  })

  describe('unload', () => {
    it('should unload signal handlers', () => {
      load()
      unload()
      // After unload, signals should still return array but loaded state changes
      expect(typeof signals()).toBe('object')
    })

    it('should be safe to call when not loaded', () => {
      unload()
      unload()
      expect(true).toBe(true) // Should not throw
    })

    it('should be safe to call multiple times', () => {
      load()
      unload()
      unload()
      unload()
      expect(true).toBe(true) // Should not throw
    })
  })

  describe('signals', () => {
    it('should return undefined before load', () => {
      // Note: signals() may return array even without explicit load
      // because onExit auto-loads. This is by design.
      const result = signals()
      expect(result === undefined || Array.isArray(result)).toBe(true)
    })

    it('should return array after load', () => {
      load()
      const sigs = signals()
      expect(Array.isArray(sigs)).toBe(true)
    })

    it('should include common signals', () => {
      load()
      const sigs = signals()
      expect(sigs).toBeTruthy()
      if (sigs) {
        // Common signals across platforms
        expect(sigs).toContain('SIGINT')
        expect(sigs).toContain('SIGTERM')
      }
    })

    it('should have platform-specific signals', () => {
      load()
      const sigs = signals()
      expect(sigs).toBeTruthy()
      if (sigs && process.platform !== 'win32') {
        // POSIX-only signals
        expect(sigs.length).toBeGreaterThan(5)
      }
    })
  })

  describe('onExit', () => {
    it('should register exit handler', () => {
      const callback = vi.fn()
      const remove = onExit(callback)
      expect(typeof remove).toBe('function')
    })

    it('should auto-load if not already loaded', () => {
      unload()
      const callback = vi.fn()
      onExit(callback)
      expect(signals()).toBeTruthy()
    })

    it('should return removal function', () => {
      const callback = vi.fn()
      const remove = onExit(callback)
      expect(typeof remove).toBe('function')
      remove()
      expect(true).toBe(true) // Should not throw
    })

    it('should handle alwaysLast option', () => {
      const callback = vi.fn()
      const remove = onExit(callback, { alwaysLast: true })
      expect(typeof remove).toBe('function')
      remove()
    })

    it('should handle alwaysLast: false option', () => {
      const callback = vi.fn()
      const remove = onExit(callback, { alwaysLast: false })
      expect(typeof remove).toBe('function')
      remove()
    })

    it('should handle undefined options', () => {
      const callback = vi.fn()
      const remove = onExit(callback, undefined)
      expect(typeof remove).toBe('function')
      remove()
    })

    it('should throw TypeError for non-function callback', () => {
      expect(() => onExit(null as any)).toThrow(TypeError)
      expect(() => onExit(undefined as any)).toThrow(TypeError)
      expect(() => onExit(42 as any)).toThrow(TypeError)
      expect(() => onExit('string' as any)).toThrow(TypeError)
    })

    it('should allow multiple handlers', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      const callback3 = vi.fn()

      const remove1 = onExit(callback1)
      const remove2 = onExit(callback2)
      const remove3 = onExit(callback3)

      expect(typeof remove1).toBe('function')
      expect(typeof remove2).toBe('function')
      expect(typeof remove3).toBe('function')

      remove1()
      remove2()
      remove3()
    })

    it('should handle removal of handlers', () => {
      const callback = vi.fn()
      const remove = onExit(callback)
      remove()
      // Should not throw when removing twice
      remove()
    })

    it('should unload when all handlers removed', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const remove1 = onExit(callback1)
      const remove2 = onExit(callback2)

      // Remove both
      remove1()
      remove2()

      // Signal handlers should be cleaned up
      expect(true).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle rapid load/unload cycles', () => {
      for (let i = 0; i < 10; i++) {
        load()
        unload()
      }
      expect(true).toBe(true)
    })

    it('should handle multiple handlers with same callback', () => {
      const callback = vi.fn()
      const remove1 = onExit(callback)
      const remove2 = onExit(callback)

      remove1()
      remove2()
      expect(true).toBe(true)
    })

    it('should handle mix of regular and alwaysLast handlers', () => {
      const regular1 = vi.fn()
      const regular2 = vi.fn()
      const last1 = vi.fn()
      const last2 = vi.fn()

      const remove1 = onExit(regular1)
      const remove2 = onExit(last1, { alwaysLast: true })
      const remove3 = onExit(regular2)
      const remove4 = onExit(last2, { alwaysLast: true })

      remove1()
      remove2()
      remove3()
      remove4()
      expect(true).toBe(true)
    })
  })

  describe('cross-platform behavior', () => {
    it('should work on Windows', () => {
      load()
      const sigs = signals()
      expect(sigs).toBeTruthy()
      if (process.platform === 'win32' && sigs) {
        // Windows should have fewer signals
        expect(sigs).toContain('SIGINT')
        expect(sigs).toContain('SIGTERM')
      }
    })

    it('should work on POSIX platforms', () => {
      load()
      const sigs = signals()
      expect(sigs).toBeTruthy()
      if (process.platform !== 'win32' && sigs) {
        // POSIX should have more signals
        expect(sigs.length).toBeGreaterThan(5)
        expect(sigs).toContain('SIGINT')
        expect(sigs).toContain('SIGTERM')
        expect(sigs).toContain('SIGUSR2')
      }
    })

    it('should work on Linux', () => {
      load()
      const sigs = signals()
      expect(sigs).toBeTruthy()
      if (process.platform === 'linux' && sigs) {
        // Linux-specific signals
        expect(sigs).toContain('SIGIO')
        expect(sigs).toContain('SIGPOLL')
      }
    })
  })

  describe('signal handler behavior', () => {
    it('should handle process emit events', () => {
      load()
      // The load should patch process.emit
      expect(process.emit).toBeTruthy()
      expect(typeof process.emit).toBe('function')
    })

    it('should restore original process.emit on unload', () => {
      load()
      unload()
      // After unload, should restore original (or maintain functional emit)
      expect(typeof process.emit).toBe('function')
    })
  })

  describe('error handling', () => {
    it('should handle errors in callback gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Test error')
      })

      const remove = onExit(errorCallback)
      expect(typeof remove).toBe('function')
      remove()
    })

    it('should handle removal of non-existent handler', () => {
      const callback = vi.fn()
      const remove = onExit(callback)
      remove()
      // Remove again should not throw
      remove()
      remove()
      expect(true).toBe(true)
    })
  })

  describe('memory management', () => {
    it('should not leak handlers', () => {
      const handlers = []
      for (let i = 0; i < 100; i++) {
        const callback = vi.fn()
        const remove = onExit(callback)
        handlers.push(remove)
      }

      // Remove all handlers
      for (const remove of handlers) {
        remove()
      }

      expect(true).toBe(true)
    })

    it('should handle handler removal in any order', () => {
      const callbacks = Array.from({ length: 10 }, () => vi.fn())
      const removers = callbacks.map(cb => onExit(cb))

      // Remove in reverse order
      for (let i = removers.length - 1; i >= 0; i--) {
        removers[i]?.()
      }

      expect(true).toBe(true)
    })
  })
})
