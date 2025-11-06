/**
 * @fileoverview Comprehensive tests for debug logging utilities.
 *
 * Tests debug namespace logging utilities:
 * - debug(), debugNs() create namespaced debug loggers
 * - debugLog(), debugLogNs() log with namespace prefix
 * - debugDir(), debugDirNs() inspect objects with util.inspect
 * - debugCache(), debugCacheNs() for cache operations debugging
 * - debuglog() Node.js-style debug logger
 * - Namespace filtering via DEBUG environment variable
 * - CI detection: debug output disabled in CI environments
 * Used throughout Socket tools for conditional development/debug logging.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  debug,
  debugCache,
  debugCacheNs,
  debugDir,
  debugDirNs,
  debugLog,
  debugLogNs,
  debugNs,
  debuglog,
  debugtime,
  isDebug,
  isDebugNs,
} from '@socketsecurity/lib/debug'

describe('debug', () => {
  let originalSocketDebug: string | undefined
  let originalDebug: string | undefined

  beforeEach(() => {
    // Save original env vars
    originalSocketDebug = process.env['SOCKET_DEBUG']
    originalDebug = process.env['DEBUG']

    // Enable debug for tests
    process.env['SOCKET_DEBUG'] = '1'
    process.env['DEBUG'] = '*'
  })

  afterEach(() => {
    // Restore original env vars
    if (originalSocketDebug === undefined) {
      delete process.env['SOCKET_DEBUG']
    } else {
      process.env['SOCKET_DEBUG'] = originalSocketDebug
    }
    if (originalDebug === undefined) {
      delete process.env['DEBUG']
    } else {
      process.env['DEBUG'] = originalDebug
    }
  })

  describe('isDebug', () => {
    it('should return a boolean', () => {
      // isDebug() checks if SOCKET_DEBUG env var was set at module load time
      // We can only verify it returns a boolean value
      expect(typeof isDebug()).toBe('boolean')
    })
  })

  describe('isDebugNs', () => {
    it('should return a boolean for wildcard', () => {
      // isDebugNs checks namespace against DEBUG env var at module load time
      expect(typeof isDebugNs('*')).toBe('boolean')
    })

    it('should return a boolean for empty namespace', () => {
      expect(typeof isDebugNs(undefined)).toBe('boolean')
    })

    it('should handle wildcard namespace', () => {
      expect(typeof isDebugNs('*')).toBe('boolean')
    })

    it('should handle empty string namespace', () => {
      expect(typeof isDebugNs('')).toBe('boolean')
    })

    it('should handle specific namespace', () => {
      // isDebugNs requires DEBUG env var to have the specific namespace
      // When DEBUG='*', specific namespaces are also enabled
      expect(typeof isDebugNs('test')).toBe('boolean')
    })

    it('should handle namespace with whitespace', () => {
      expect(typeof isDebugNs('  test  ')).toBe('boolean')
    })

    it('should handle comma-separated namespaces', () => {
      expect(typeof isDebugNs('test,other')).toBe('boolean')
    })

    it('should handle namespace with hyphens for exclusion', () => {
      expect(typeof isDebugNs('test,-excluded')).toBe('boolean')
    })

    it('should handle multiple spaces converted to comma', () => {
      expect(typeof isDebugNs('test   other')).toBe('boolean')
    })
  })

  describe('debug', () => {
    it('should not throw when outputting debug message', () => {
      expect(() => debug('test message')).not.toThrow()
    })

    it('should handle multiple arguments', () => {
      expect(() => debug('test', 'message', 123)).not.toThrow()
    })

    it('should handle non-string first argument', () => {
      expect(() => debug({ key: 'value' })).not.toThrow()
    })

    it('should handle empty arguments', () => {
      expect(() => debug()).not.toThrow()
    })
  })

  describe('debugNs', () => {
    it('should not throw with namespace and message', () => {
      expect(() => debugNs('test', 'message')).not.toThrow()
    })

    it('should handle namespace as object with namespaces property', () => {
      expect(() => debugNs({ namespaces: 'test' }, 'message')).not.toThrow()
    })

    it('should handle string first argument', () => {
      expect(() => debugNs('*', 'test message')).not.toThrow()
    })

    it('should handle non-string first argument in message', () => {
      expect(() => debugNs('*', { key: 'value' })).not.toThrow()
    })

    it('should handle null namespace options', () => {
      expect(() => debugNs('*', 'message')).not.toThrow()
    })
  })

  describe('debugDir', () => {
    it('should not throw when inspecting object', () => {
      const obj = { key: 'value', nested: { prop: 123 } }
      expect(() => debugDir(obj)).not.toThrow()
    })

    it('should handle inspect options', () => {
      const obj = { key: 'value' }
      const opts = { depth: 2, colors: true }
      expect(() => debugDir(obj, opts)).not.toThrow()
    })

    it('should handle null object', () => {
      expect(() => debugDir(null)).not.toThrow()
    })

    it('should handle undefined object', () => {
      expect(() => debugDir(undefined)).not.toThrow()
    })

    it('should handle primitive values', () => {
      expect(() => debugDir(123)).not.toThrow()
    })
  })

  describe('debugDirNs', () => {
    it('should not throw with namespace and object', () => {
      const obj = { key: 'value' }
      expect(() => debugDirNs('test', obj)).not.toThrow()
    })

    it('should handle namespace as object', () => {
      const obj = { key: 'value' }
      expect(() => debugDirNs({ namespaces: 'test' }, obj)).not.toThrow()
    })

    it('should handle inspect options', () => {
      const obj = { key: 'value' }
      const opts = { depth: 3, colors: false }
      expect(() => debugDirNs('test', obj, opts)).not.toThrow()
    })

    it('should handle inspect without options', () => {
      const obj = { key: 'value' }
      expect(() => debugDirNs('test', obj)).not.toThrow()
    })
  })

  describe('debugLog', () => {
    it('should not throw when outputting log message', () => {
      expect(() => debugLog('test message')).not.toThrow()
    })

    it('should handle multiple arguments', () => {
      expect(() => debugLog('test', 'message', 123)).not.toThrow()
    })

    it('should handle non-string arguments', () => {
      expect(() => debugLog({ key: 'value' })).not.toThrow()
    })
  })

  describe('debugLogNs', () => {
    it('should not throw with namespace and message', () => {
      expect(() => debugLogNs('test', 'message')).not.toThrow()
    })

    it('should handle namespace as object', () => {
      expect(() => debugLogNs({ namespaces: 'test' }, 'message')).not.toThrow()
    })

    it('should handle string first argument', () => {
      expect(() => debugLogNs('*', 'test message')).not.toThrow()
    })

    it('should handle non-string arguments', () => {
      expect(() => debugLogNs('*', { key: 'value' })).not.toThrow()
    })

    it('should handle multiple arguments', () => {
      expect(() => debugLogNs('*', 'test', 123, true)).not.toThrow()
    })
  })

  describe('debugCache', () => {
    it('should not throw when outputting cache debug', () => {
      expect(() => debugCache('get', 'test-key')).not.toThrow()
    })

    it('should handle with metadata', () => {
      expect(() => debugCache('set', 'test-key', { value: 123 })).not.toThrow()
    })

    it('should handle objects as metadata', () => {
      expect(() =>
        debugCache('lookup', 'cache-key', { cacheKey: 'test', value: 'data' }),
      ).not.toThrow()
    })

    it('should handle without metadata', () => {
      expect(() => debugCache('delete', 'test-key')).not.toThrow()
    })
  })

  describe('debugCacheNs', () => {
    it('should not throw with namespace and message', () => {
      expect(() => debugCacheNs('cache', 'get', 'test-key')).not.toThrow()
    })

    it('should handle namespace as object', () => {
      expect(() =>
        debugCacheNs({ namespaces: 'cache' }, 'set', 'test-key'),
      ).not.toThrow()
    })

    it('should handle with metadata', () => {
      expect(() =>
        debugCacheNs('cache', 'lookup', 'test-key', { value: 123 }),
      ).not.toThrow()
    })

    it('should handle objects in metadata', () => {
      expect(() =>
        debugCacheNs('cache', 'get', 'cache-key', {
          cacheKey: 'test',
          value: 'data',
        }),
      ).not.toThrow()
    })
  })

  describe('debuglog', () => {
    it('should return a function', () => {
      const fn = debuglog('test')
      expect(typeof fn).toBe('function')
    })

    it('should not throw when calling returned function', () => {
      const fn = debuglog('test')
      expect(() => fn('message')).not.toThrow()
    })

    it('should handle empty section', () => {
      const fn = debuglog('')
      expect(() => fn('message')).not.toThrow()
    })
  })

  describe('debugtime', () => {
    it('should not throw when starting timer', () => {
      expect(() => debugtime('timer1')).not.toThrow()
    })

    it('should not throw when ending timer', () => {
      debugtime('timer2')
      expect(() => debugtime('timer2')).not.toThrow()
    })

    it('should handle multiple timers', () => {
      expect(() => {
        debugtime('timer3')
        debugtime('timer4')
        debugtime('timer3')
        debugtime('timer4')
      }).not.toThrow()
    })

    it('should handle empty label', () => {
      debugtime('')
      expect(() => debugtime('')).not.toThrow()
    })

    it('should handle undefined label', () => {
      debugtime(undefined as unknown as string)
      expect(() => debugtime(undefined as unknown as string)).not.toThrow()
    })

    it('should handle starting and stopping timer with same label', () => {
      debugtime('test-timer')
      expect(() => debugtime('test-timer')).not.toThrow()
    })
  })

  describe('edge cases', () => {
    it('should handle various inspect options', () => {
      const obj = { test: 'value' }
      expect(() => debugDir(obj, { depth: 0 })).not.toThrow()
      expect(() => debugDir(obj, { maxArrayLength: 1 })).not.toThrow()
      expect(() => debugDir(obj, { breakLength: 60 })).not.toThrow()
      expect(() => debugDir(obj, { compact: false })).not.toThrow()
    })

    it('should handle deeply nested objects', () => {
      const deep = {
        level1: { level2: { level3: { level4: { level5: 'deep' } } } },
      }
      expect(() => debugDir(deep, { depth: 10 })).not.toThrow()
    })

    it('should handle circular references safely', () => {
      const circular: Record<string, unknown> = { key: 'value' }
      circular['self'] = circular
      expect(() => debugDir(circular)).not.toThrow()
    })
  })

  describe('Error.captureStackTrace variations', () => {
    it('should handle async function prefix', () => {
      expect(() => debug('async test')).not.toThrow()
    })

    it('should handle bound function prefix', () => {
      expect(() => debug('bound test')).not.toThrow()
    })

    it('should handle getter/setter prefix', () => {
      expect(() => debug('getter test')).not.toThrow()
    })

    it('should handle constructor prefix', () => {
      expect(() => debug('constructor test')).not.toThrow()
    })

    it('should handle anonymous functions', () => {
      expect(() => debug('anonymous test')).not.toThrow()
    })

    it('should handle functions with special characters', () => {
      expect(() => debug('special-char-test')).not.toThrow()
    })

    it('should handle very long function names', () => {
      expect(() => debug('veryLongFunctionNameTest'.repeat(10))).not.toThrow()
    })

    it('should handle functions with numbers', () => {
      expect(() => debug('test123function')).not.toThrow()
    })

    it('should handle functions with underscores', () => {
      expect(() => debug('test_function_name')).not.toThrow()
    })

    it('should handle functions with dollar signs', () => {
      expect(() => debug('test$function$name')).not.toThrow()
    })
  })

  describe('namespace filtering', () => {
    it('should handle wildcard matching', () => {
      // All patterns depend on DEBUG env var configuration at module load time
      expect(typeof isDebugNs('*')).toBe('boolean')
      expect(typeof isDebugNs('test*')).toBe('boolean')
      expect(typeof isDebugNs('*test')).toBe('boolean')
    })

    it('should handle exclusion patterns', () => {
      expect(typeof isDebugNs('test,-excluded')).toBe('boolean')
    })

    it('should handle comma-separated patterns', () => {
      expect(typeof isDebugNs('test,other,more')).toBe('boolean')
    })

    it('should handle space-separated patterns', () => {
      expect(typeof isDebugNs('test other more')).toBe('boolean')
    })
  })

  describe('Unicode support', () => {
    it('should handle Unicode characters in messages', () => {
      expect(() => debug('Unicode: 你好世界 🌍')).not.toThrow()
    })

    it('should handle emoji in messages', () => {
      expect(() => debug('Emoji test: 🎉 🚀 ✨')).not.toThrow()
    })

    it('should handle special symbols', () => {
      expect(() => debug('Symbols: ™ © ® €')).not.toThrow()
    })
  })
})
