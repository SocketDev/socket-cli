/**
 * @fileoverview Unit tests for environment variable utilities.
 *
 * Tests core environment variable utility functions:
 * - Type conversion: envAsBoolean(), envAsNumber(), envAsString()
 * - Case-insensitive key lookup: findCaseInsensitiveEnvKey()
 * - Proxy creation: createEnvProxy() for controlled env access
 * - Validation: isValidEnvValue(), parseEnvValue()
 * These utilities provide a foundation for consistent env var handling.
 * No rewire needed - tests pure functions and proxy creation.
 */

import {
  createEnvProxy,
  envAsBoolean,
  envAsNumber,
  envAsString,
  findCaseInsensitiveEnvKey,
} from '@socketsecurity/lib/env'
import { describe, expect, it } from 'vitest'

describe('env', () => {
  describe('envAsBoolean', () => {
    it('should convert string "1" to true', () => {
      expect(envAsBoolean('1')).toBe(true)
    })

    it('should convert string "true" to true (case-insensitive)', () => {
      expect(envAsBoolean('true')).toBe(true)
      expect(envAsBoolean('TRUE')).toBe(true)
      expect(envAsBoolean('True')).toBe(true)
    })

    it('should convert string "0" to false', () => {
      expect(envAsBoolean('0')).toBe(false)
    })

    it('should convert string "false" to false', () => {
      expect(envAsBoolean('false')).toBe(false)
      expect(envAsBoolean('FALSE')).toBe(false)
    })

    it('should convert any other string to false', () => {
      expect(envAsBoolean('no')).toBe(false)
      expect(envAsBoolean('yes')).toBe(false)
      expect(envAsBoolean('random')).toBe(false)
    })

    it('should trim whitespace from strings', () => {
      expect(envAsBoolean('  1  ')).toBe(true)
      expect(envAsBoolean('  true  ')).toBe(true)
      expect(envAsBoolean('  0  ')).toBe(false)
    })

    it('should use default value for null', () => {
      expect(envAsBoolean(null)).toBe(false)
      expect(envAsBoolean(null, true)).toBe(true)
    })

    it('should use default value for undefined', () => {
      expect(envAsBoolean(undefined)).toBe(false)
      expect(envAsBoolean(undefined, true)).toBe(true)
    })

    it('should convert truthy non-string values to true', () => {
      expect(envAsBoolean(1)).toBe(true)
      expect(envAsBoolean({})).toBe(true)
      expect(envAsBoolean([])).toBe(true)
    })

    it('should convert falsy non-string values to false', () => {
      expect(envAsBoolean(0)).toBe(false)
      expect(envAsBoolean('')).toBe(false)
    })

    it('should handle empty string', () => {
      expect(envAsBoolean('')).toBe(false)
      expect(envAsBoolean('   ')).toBe(false)
    })
  })

  describe('envAsNumber', () => {
    it('should convert string numbers to integers', () => {
      expect(envAsNumber('42')).toBe(42)
      expect(envAsNumber('0')).toBe(0)
      expect(envAsNumber('123')).toBe(123)
    })

    it('should convert negative numbers', () => {
      expect(envAsNumber('-42')).toBe(-42)
      expect(envAsNumber('-1')).toBe(-1)
    })

    it('should use default value for invalid strings', () => {
      expect(envAsNumber('invalid')).toBe(0)
      expect(envAsNumber('invalid', 10)).toBe(10)
      expect(envAsNumber('abc', 42)).toBe(42)
    })

    it('should parse integers from strings with decimals', () => {
      expect(envAsNumber('42.7')).toBe(42)
      expect(envAsNumber('3.14')).toBe(3)
    })

    it('should handle null and undefined', () => {
      expect(envAsNumber(null)).toBe(0)
      expect(envAsNumber(undefined)).toBe(0)
      expect(envAsNumber(null, 10)).toBe(10)
      expect(envAsNumber(undefined, 10)).toBe(10)
    })

    it('should handle empty string', () => {
      expect(envAsNumber('')).toBe(0)
      expect(envAsNumber('', 5)).toBe(5)
    })

    it('should handle whitespace', () => {
      expect(envAsNumber('  42  ')).toBe(42)
    })

    it('should handle -0 and return 0', () => {
      expect(envAsNumber('-0')).toBe(0)
      expect(Object.is(envAsNumber('-0'), 0)).toBe(true)
    })

    it('should handle NaN and return default', () => {
      expect(envAsNumber('notanumber')).toBe(0)
      expect(envAsNumber('notanumber', 99)).toBe(99)
    })

    it('should handle Infinity and return default', () => {
      expect(envAsNumber('Infinity')).toBe(0)
      expect(envAsNumber('Infinity', 100)).toBe(100)
    })

    it('should parse hex strings as base 10', () => {
      expect(envAsNumber('0x10')).toBe(0)
      expect(envAsNumber('10')).toBe(10)
    })

    it('should handle leading zeros', () => {
      expect(envAsNumber('007')).toBe(7)
      expect(envAsNumber('00042')).toBe(42)
    })
  })

  describe('envAsString', () => {
    it('should trim string values', () => {
      expect(envAsString('  hello  ')).toBe('hello')
      expect(envAsString('test')).toBe('test')
    })

    it('should use default value for null', () => {
      expect(envAsString(null)).toBe('')
      expect(envAsString(null, 'default')).toBe('default')
    })

    it('should use default value for undefined', () => {
      expect(envAsString(undefined)).toBe('')
      expect(envAsString(undefined, 'default')).toBe('default')
    })

    it('should convert non-string values to strings', () => {
      expect(envAsString(42)).toBe('42')
      expect(envAsString(true)).toBe('true')
      expect(envAsString(false)).toBe('false')
    })

    it('should handle empty string', () => {
      expect(envAsString('')).toBe('')
      expect(envAsString('   ')).toBe('')
    })

    it('should trim default value if it is a string', () => {
      expect(envAsString(null, '  default  ')).toBe('default')
    })

    it('should convert default value to string and trim', () => {
      expect(envAsString(null, 123 as any)).toBe('123')
    })

    it('should handle default value as empty string', () => {
      expect(envAsString(null, '')).toBe('')
    })

    it('should handle objects by converting to string', () => {
      expect(envAsString({ key: 'value' })).toBe('[object Object]')
    })

    it('should handle arrays by converting to string', () => {
      expect(envAsString([1, 2, 3])).toBe('1,2,3')
    })
  })

  describe('findCaseInsensitiveEnvKey', () => {
    it('should find exact match', () => {
      const env = { PATH: '/usr/bin', HOME: '/home/user' }
      expect(findCaseInsensitiveEnvKey(env, 'PATH')).toBe('PATH')
      expect(findCaseInsensitiveEnvKey(env, 'HOME')).toBe('HOME')
    })

    it('should find case-insensitive match', () => {
      const env = { Path: '/usr/bin', home: '/home/user' }
      expect(findCaseInsensitiveEnvKey(env, 'PATH')).toBe('Path')
      expect(findCaseInsensitiveEnvKey(env, 'HOME')).toBe('home')
    })

    it('should find mixed case matches', () => {
      const env = { pAtH: '/usr/bin', HoMe: '/home/user' }
      expect(findCaseInsensitiveEnvKey(env, 'PATH')).toBe('pAtH')
      expect(findCaseInsensitiveEnvKey(env, 'HOME')).toBe('HoMe')
    })

    it('should return undefined for non-existent keys', () => {
      const env = { PATH: '/usr/bin' }
      expect(findCaseInsensitiveEnvKey(env, 'HOME')).toBeUndefined()
      expect(findCaseInsensitiveEnvKey(env, 'MISSING')).toBeUndefined()
    })

    it('should return undefined for empty object', () => {
      expect(findCaseInsensitiveEnvKey({}, 'PATH')).toBeUndefined()
    })

    it('should skip keys with different lengths (optimization)', () => {
      const env = { PATHS: '/usr/bin', PATHX: '/usr/local/bin' }
      expect(findCaseInsensitiveEnvKey(env, 'PATH')).toBeUndefined()
    })

    it('should handle single character keys', () => {
      const env = { A: 'value', b: 'value2' }
      expect(findCaseInsensitiveEnvKey(env, 'A')).toBe('A')
      expect(findCaseInsensitiveEnvKey(env, 'B')).toBe('b')
    })

    it('should handle keys with underscores', () => {
      const env = { NODE_ENV: 'test', node_env: 'prod' }
      expect(findCaseInsensitiveEnvKey(env, 'NODE_ENV')).toBe('NODE_ENV')
    })

    it('should return first match when multiple case variations exist', () => {
      const env = { path: '/first', Path: '/second', PATH: '/third' }
      const result = findCaseInsensitiveEnvKey(env, 'PATH')
      expect(['path', 'Path', 'PATH']).toContain(result)
    })

    it('should handle undefined values in env', () => {
      const env = { PATH: undefined, HOME: '/home/user' }
      expect(findCaseInsensitiveEnvKey(env, 'PATH')).toBe('PATH')
    })
  })

  describe('createEnvProxy', () => {
    describe('basic functionality', () => {
      it('should return proxy that reads from base env', () => {
        const base = { PATH: '/usr/bin', HOME: '/home/user' }
        const proxy = createEnvProxy(base)
        expect(proxy.PATH).toBe('/usr/bin')
        expect(proxy.HOME).toBe('/home/user')
      })

      it('should return proxy that reads from overrides', () => {
        const base = { PATH: '/usr/bin' }
        const overrides = { NODE_ENV: 'test' }
        const proxy = createEnvProxy(base, overrides)
        expect(proxy.NODE_ENV).toBe('test')
        expect(proxy.PATH).toBe('/usr/bin')
      })

      it('should prioritize overrides over base', () => {
        const base = { PATH: '/usr/bin', HOME: '/home/user' }
        const overrides = { PATH: '/custom/bin' }
        const proxy = createEnvProxy(base, overrides)
        expect(proxy.PATH).toBe('/custom/bin')
        expect(proxy.HOME).toBe('/home/user')
      })

      it('should return undefined for non-existent keys', () => {
        const base = { PATH: '/usr/bin' }
        const proxy = createEnvProxy(base)
        expect(proxy.NONEXISTENT).toBeUndefined()
      })

      it('should work without overrides', () => {
        const base = { PATH: '/usr/bin' }
        const proxy = createEnvProxy(base)
        expect(proxy.PATH).toBe('/usr/bin')
      })
    })

    describe('case-insensitive lookups', () => {
      it('should find PATH with different cases', () => {
        const base = { Path: 'C:\\Windows' }
        const proxy = createEnvProxy(base)
        expect(proxy.PATH).toBe('C:\\Windows')
        expect(proxy.Path).toBe('C:\\Windows')
        expect(proxy.path).toBe('C:\\Windows')
      })

      it('should find TEMP with different cases', () => {
        const base = { Temp: 'C:\\Temp' }
        const proxy = createEnvProxy(base)
        expect(proxy.TEMP).toBe('C:\\Temp')
        expect(proxy.temp).toBe('C:\\Temp')
      })

      it('should find HOME with different cases', () => {
        const base = { home: '/home/user' }
        const proxy = createEnvProxy(base)
        expect(proxy.HOME).toBe('/home/user')
        expect(proxy.Home).toBe('/home/user')
      })

      it('should prioritize exact match over case-insensitive', () => {
        const base = { PATH: '/exact', Path: '/alt' }
        const proxy = createEnvProxy(base)
        expect(proxy.PATH).toBe('/exact')
        expect(proxy.Path).toBe('/alt')
      })

      it('should check overrides for case-insensitive matches', () => {
        const base = { path: '/base/path' }
        const overrides = { Path: '/override/path' }
        const proxy = createEnvProxy(base, overrides)
        // Access with 'PATH' should find 'Path' in overrides via case-insensitive lookup.
        expect(proxy.PATH).toBe('/override/path')
      })

      it('should not do case-insensitive lookup for non-Windows vars', () => {
        const base = { myVar: 'value' }
        const proxy = createEnvProxy(base)
        expect(proxy.MYVAR).toBeUndefined()
        expect(proxy.myVar).toBe('value')
      })
    })

    describe('Proxy handlers', () => {
      it('should support "in" operator', () => {
        const base = { PATH: '/usr/bin' }
        const proxy = createEnvProxy(base)
        expect('PATH' in proxy).toBe(true)
        expect('HOME' in proxy).toBe(false)
      })

      it('should support "in" operator with case-insensitive keys', () => {
        const base = { Path: '/usr/bin' }
        const proxy = createEnvProxy(base)
        expect('PATH' in proxy).toBe(true)
        expect('path' in proxy).toBe(true)
      })

      it('should support Object.keys', () => {
        const base = { PATH: '/usr/bin', HOME: '/home/user' }
        const overrides = { NODE_ENV: 'test' }
        const proxy = createEnvProxy(base, overrides)
        const keys = Object.keys(proxy)
        expect(keys).toContain('PATH')
        expect(keys).toContain('HOME')
        expect(keys).toContain('NODE_ENV')
        expect(keys).toHaveLength(3)
      })

      it('should deduplicate keys in Object.keys', () => {
        const base = { PATH: '/usr/bin' }
        const overrides = { PATH: '/custom/bin' }
        const proxy = createEnvProxy(base, overrides)
        const keys = Object.keys(proxy)
        expect(keys.filter(k => k === 'PATH')).toHaveLength(1)
      })

      it('should support Object.getOwnPropertyDescriptor', () => {
        const base = { PATH: '/usr/bin' }
        const proxy = createEnvProxy(base)
        const descriptor = Object.getOwnPropertyDescriptor(proxy, 'PATH')
        expect(descriptor).toBeDefined()
        expect(descriptor?.value).toBe('/usr/bin')
        expect(descriptor?.enumerable).toBe(true)
        expect(descriptor?.configurable).toBe(true)
        expect(descriptor?.writable).toBe(true)
      })

      it('should return undefined descriptor for non-existent keys', () => {
        const base = { PATH: '/usr/bin' }
        const proxy = createEnvProxy(base)
        const descriptor = Object.getOwnPropertyDescriptor(proxy, 'NONEXISTENT')
        expect(descriptor).toBeUndefined()
      })

      it('should support set operation with overrides', () => {
        const base = { PATH: '/usr/bin' }
        const overrides: Record<string, string | undefined> = {
          NODE_ENV: 'test',
        }
        const proxy = createEnvProxy(base, overrides)
        ;(proxy as any).NEW_VAR = 'new-value'
        expect((proxy as any).NEW_VAR).toBe('new-value')
        expect(overrides.NEW_VAR).toBe('new-value')
      })

      it('should not support set operation without overrides', () => {
        const base = { PATH: '/usr/bin' }
        const proxy = createEnvProxy(base)
        const result = Reflect.set(proxy, 'NEW_VAR', 'value')
        expect(result).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('should handle empty base and overrides', () => {
        const proxy = createEnvProxy({})
        expect(proxy.PATH).toBeUndefined()
        expect(Object.keys(proxy)).toHaveLength(0)
      })

      it('should handle non-string property access', () => {
        const base = { PATH: '/usr/bin' }
        const proxy = createEnvProxy(base)
        expect(proxy[Symbol.iterator as any]).toBeUndefined()
      })

      it('should handle undefined values in base', () => {
        const base = { PATH: undefined as any, HOME: '/home/user' }
        const proxy = createEnvProxy(base)
        expect(proxy.PATH).toBeUndefined()
        expect(proxy.HOME).toBe('/home/user')
      })

      it('should handle undefined values in overrides', () => {
        const base = { PATH: '/usr/bin' }
        const overrides = { NODE_ENV: undefined }
        const proxy = createEnvProxy(base, overrides)
        expect(proxy.NODE_ENV).toBeUndefined()
        expect(proxy.PATH).toBe('/usr/bin')
      })

      it('should enumerate all unique keys', () => {
        const base = { A: '1', B: '2', C: '3' }
        const overrides = { B: '20', D: '4' }
        const proxy = createEnvProxy(base, overrides)
        const keys = Object.keys(proxy).sort()
        expect(keys).toEqual(['A', 'B', 'C', 'D'])
      })

      it('should handle case-insensitive has check', () => {
        const base = { Path: '/usr/bin' }
        const proxy = createEnvProxy(base)
        expect('PATH' in proxy).toBe(true)
        expect('path' in proxy).toBe(true)
        expect('Path' in proxy).toBe(true)
      })

      it('should handle all Windows environment variables', () => {
        const base = {
          APPDATA: 'C:\\Users\\user\\AppData',
          COMSPEC: 'C:\\Windows\\system32\\cmd.exe',
          HOME: 'C:\\Users\\user',
          LOCALAPPDATA: 'C:\\Users\\user\\AppData\\Local',
          PATH: 'C:\\Windows',
          PATHEXT: '.COM;.EXE;.BAT',
          PROGRAMFILES: 'C:\\Program Files',
          SYSTEMROOT: 'C:\\Windows',
          TEMP: 'C:\\Temp',
          TMP: 'C:\\Temp',
          USERPROFILE: 'C:\\Users\\user',
          WINDIR: 'C:\\Windows',
        }
        const proxy = createEnvProxy(base)

        // Test case-insensitive access for all Windows vars.
        expect(proxy.appdata).toBe(base.APPDATA)
        expect(proxy.comspec).toBe(base.COMSPEC)
        expect(proxy.home).toBe(base.HOME)
        expect(proxy.localappdata).toBe(base.LOCALAPPDATA)
        expect(proxy.path).toBe(base.PATH)
        expect(proxy.pathext).toBe(base.PATHEXT)
        expect(proxy.programfiles).toBe(base.PROGRAMFILES)
        expect(proxy.systemroot).toBe(base.SYSTEMROOT)
        expect(proxy.temp).toBe(base.TEMP)
        expect(proxy.tmp).toBe(base.TMP)
        expect(proxy.userprofile).toBe(base.USERPROFILE)
        expect(proxy.windir).toBe(base.WINDIR)
      })
    })

    describe('Windows compatibility', () => {
      it('should handle mixed case PATH variations', () => {
        const base = { Path: 'C:\\Windows;C:\\Program Files' }
        const proxy = createEnvProxy(base)
        expect(proxy.PATH).toBe(base.Path)
        expect(proxy.path).toBe(base.Path)
        expect(proxy.PaTh).toBe(base.Path)
      })

      it('should preserve case when setting via proxy', () => {
        const base = { PATH: '/usr/bin' }
        const overrides: Record<string, string | undefined> = {}
        const proxy = createEnvProxy(base, overrides)
        ;(proxy as any).NewVar = 'value'
        expect(overrides['NewVar']).toBe('value')
        expect((proxy as any).NewVar).toBe('value')
      })
    })
  })
})
