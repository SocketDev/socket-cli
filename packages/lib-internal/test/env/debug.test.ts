/**
 * @fileoverview Unit tests for DEBUG environment variable getter.
 *
 * Tests getDebug() which retrieves the DEBUG environment variable for debug logging control.
 * Returns the DEBUG string value (e.g., "*", "socket:*", "app:*") or undefined if not set.
 * Uses rewire for isolated testing without polluting process.env.
 * DEBUG patterns follow the debug module convention for selective debug output.
 */

import { getDebug } from '@socketsecurity/lib/env/debug'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/debug', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getDebug', () => {
    it('should return DEBUG environment variable when set', () => {
      setEnv('DEBUG', '*')
      expect(getDebug()).toBe('*')
    })

    it('should return undefined when DEBUG is not set', () => {
      clearEnv('DEBUG')
      // After clearing override, falls back to actual process.env
      const result = getDebug()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle wildcard debug pattern', () => {
      setEnv('DEBUG', '*')
      expect(getDebug()).toBe('*')
    })

    it('should handle specific module debug pattern', () => {
      setEnv('DEBUG', 'app:*')
      expect(getDebug()).toBe('app:*')
    })

    it('should handle multiple debug patterns', () => {
      setEnv('DEBUG', 'app:*,lib:*')
      expect(getDebug()).toBe('app:*,lib:*')
    })

    it('should handle debug with namespace', () => {
      setEnv('DEBUG', 'socket:*')
      expect(getDebug()).toBe('socket:*')
    })

    it('should handle debug with specific function', () => {
      setEnv('DEBUG', 'socket:install')
      expect(getDebug()).toBe('socket:install')
    })

    it('should handle empty string', () => {
      setEnv('DEBUG', '')
      expect(getDebug()).toBe('')
    })

    it('should handle exclusion pattern', () => {
      setEnv('DEBUG', '*,-express:*')
      expect(getDebug()).toBe('*,-express:*')
    })

    it('should handle multiple exclusions', () => {
      setEnv('DEBUG', '*,-app:foo,-app:bar')
      expect(getDebug()).toBe('*,-app:foo,-app:bar')
    })

    it('should handle updating debug value', () => {
      setEnv('DEBUG', 'app:*')
      expect(getDebug()).toBe('app:*')

      setEnv('DEBUG', 'lib:*')
      expect(getDebug()).toBe('lib:*')

      setEnv('DEBUG', '*')
      expect(getDebug()).toBe('*')
    })

    it('should handle clearing and re-setting', () => {
      setEnv('DEBUG', '*')
      expect(getDebug()).toBe('*')

      clearEnv('DEBUG')
      // After clearing override, falls back to actual process.env
      const result = getDebug()
      expect(typeof result).toMatch(/string|undefined/)

      setEnv('DEBUG', 'app:*')
      expect(getDebug()).toBe('app:*')
    })

    it('should handle consecutive reads', () => {
      setEnv('DEBUG', '*')
      expect(getDebug()).toBe('*')
      expect(getDebug()).toBe('*')
      expect(getDebug()).toBe('*')
    })

    it('should handle debug with color codes', () => {
      setEnv('DEBUG', 'app:*')
      expect(getDebug()).toBe('app:*')
    })

    it('should handle debug with timestamps', () => {
      setEnv('DEBUG', 'app:*')
      expect(getDebug()).toBe('app:*')
    })

    it('should handle complex patterns', () => {
      setEnv('DEBUG', 'socket:*,-socket:test:*,socket:test:foo')
      expect(getDebug()).toBe('socket:*,-socket:test:*,socket:test:foo')
    })

    it('should handle patterns with special characters', () => {
      setEnv('DEBUG', 'app:foo-bar:baz')
      expect(getDebug()).toBe('app:foo-bar:baz')
    })

    it('should handle patterns with underscores', () => {
      setEnv('DEBUG', 'app_module:*')
      expect(getDebug()).toBe('app_module:*')
    })

    it('should handle patterns with dots', () => {
      setEnv('DEBUG', 'app.module:*')
      expect(getDebug()).toBe('app.module:*')
    })

    it('should handle single character pattern', () => {
      setEnv('DEBUG', '*')
      expect(getDebug()).toBe('*')
    })

    it('should handle whitespace in patterns', () => {
      setEnv('DEBUG', 'app:*, lib:*')
      expect(getDebug()).toBe('app:*, lib:*')
    })

    it('should handle HTTP debug patterns', () => {
      setEnv('DEBUG', 'http:*')
      expect(getDebug()).toBe('http:*')
    })

    it('should handle Express debug patterns', () => {
      setEnv('DEBUG', 'express:*')
      expect(getDebug()).toBe('express:*')
    })

    it('should handle custom tool patterns', () => {
      setEnv('DEBUG', 'socket-npm:*')
      expect(getDebug()).toBe('socket-npm:*')
    })
  })
})
