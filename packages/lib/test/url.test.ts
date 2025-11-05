/**
 * @fileoverview Unit tests for URL parsing and validation utilities.
 *
 * Tests URL manipulation and query parameter utilities:
 * - isUrl() validates URL strings
 * - parseUrl() parses URLs with error handling
 * - createRelativeUrl() constructs relative URLs
 * - urlSearchParamAs*() typed query parameter extractors (String, Number, Boolean, Array)
 * - urlSearchParamsGet*() URLSearchParams helper methods
 * Used by Socket tools for API URL construction and query parameter parsing.
 */

import {
  createRelativeUrl,
  isUrl,
  parseUrl,
  urlSearchParamAsArray,
  urlSearchParamAsBoolean,
  urlSearchParamAsNumber,
  urlSearchParamAsString,
  urlSearchParamsGetArray,
  urlSearchParamsGetBoolean,
} from '@socketsecurity/lib/url'
import { describe, expect, it } from 'vitest'

describe('url', () => {
  describe('isUrl', () => {
    it('should return true for valid HTTP URLs', () => {
      expect(isUrl('http://example.com')).toBe(true)
      expect(isUrl('https://example.com')).toBe(true)
      expect(isUrl('https://example.com/path')).toBe(true)
      expect(isUrl('https://example.com/path?query=1')).toBe(true)
    })

    it('should return true for valid URL objects', () => {
      const url = new URL('https://example.com')
      expect(isUrl(url)).toBe(true)
    })

    it('should return true for file URLs', () => {
      expect(isUrl('file:///path/to/file')).toBe(true)
    })

    it('should return true for various protocols', () => {
      expect(isUrl('ftp://example.com')).toBe(true)
      expect(isUrl('ws://example.com')).toBe(true)
      expect(isUrl('wss://example.com')).toBe(true)
    })

    it('should return false for invalid URLs', () => {
      expect(isUrl('not a url')).toBe(false)
      expect(isUrl('http://')).toBe(false)
      expect(isUrl('://missing-protocol')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isUrl('')).toBe(false)
    })

    it('should return false for null', () => {
      expect(isUrl(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isUrl(undefined)).toBe(false)
    })

    it('should return false for relative URLs without base', () => {
      expect(isUrl('/path/to/resource')).toBe(false)
      expect(isUrl('./relative')).toBe(false)
      expect(isUrl('../relative')).toBe(false)
    })

    it('should handle URLs with special characters', () => {
      expect(isUrl('https://example.com/path%20with%20spaces')).toBe(true)
      expect(isUrl('https://example.com/path?q=hello%20world')).toBe(true)
    })

    it('should handle URLs with authentication', () => {
      expect(isUrl('https://user:pass@example.com')).toBe(true)
    })

    it('should handle URLs with ports', () => {
      expect(isUrl('https://example.com:8080')).toBe(true)
      expect(isUrl('http://localhost:3000')).toBe(true)
    })

    it('should handle URLs with fragments', () => {
      expect(isUrl('https://example.com#section')).toBe(true)
      expect(isUrl('https://example.com/path#section')).toBe(true)
    })
  })

  describe('parseUrl', () => {
    it('should parse valid HTTP URLs', () => {
      const url = parseUrl('https://example.com/path')
      expect(url).toBeInstanceOf(URL)
      expect(url?.href).toBe('https://example.com/path')
      expect(url?.protocol).toBe('https:')
      expect(url?.hostname).toBe('example.com')
      expect(url?.pathname).toBe('/path')
    })

    it('should parse URL objects', () => {
      const input = new URL('https://example.com')
      const url = parseUrl(input)
      expect(url).toBeInstanceOf(URL)
      expect(url?.href).toBe('https://example.com/')
    })

    it('should parse URLs with query parameters', () => {
      const url = parseUrl('https://example.com?foo=bar&baz=qux')
      expect(url?.search).toBe('?foo=bar&baz=qux')
      expect(url?.searchParams.get('foo')).toBe('bar')
      expect(url?.searchParams.get('baz')).toBe('qux')
    })

    it('should parse URLs with fragments', () => {
      const url = parseUrl('https://example.com#section')
      expect(url?.hash).toBe('#section')
    })

    it('should parse URLs with ports', () => {
      const url = parseUrl('https://example.com:8080')
      expect(url?.port).toBe('8080')
    })

    it('should parse URLs with authentication', () => {
      const url = parseUrl('https://user:pass@example.com')
      expect(url?.username).toBe('user')
      expect(url?.password).toBe('pass')
    })

    it('should return undefined for invalid URLs', () => {
      expect(parseUrl('not a url')).toBeUndefined()
      expect(parseUrl('http://')).toBeUndefined()
      expect(parseUrl('/relative/path')).toBeUndefined()
    })

    it('should parse file URLs', () => {
      const url = parseUrl('file:///path/to/file')
      expect(url?.protocol).toBe('file:')
      expect(url?.pathname).toBe('/path/to/file')
    })

    it('should parse data URLs', () => {
      const url = parseUrl('data:text/plain;base64,SGVsbG8=')
      expect(url?.protocol).toBe('data:')
    })
  })

  describe('urlSearchParamAsArray', () => {
    it('should split comma-separated values', () => {
      expect(urlSearchParamAsArray('foo,bar,baz')).toEqual([
        'foo',
        'bar',
        'baz',
      ])
    })

    it('should trim whitespace from values', () => {
      expect(urlSearchParamAsArray('foo, bar, baz')).toEqual([
        'foo',
        'bar',
        'baz',
      ])
      expect(urlSearchParamAsArray(' foo , bar , baz ')).toEqual([
        'foo',
        'bar',
        'baz',
      ])
    })

    it('should filter out empty values', () => {
      expect(urlSearchParamAsArray('foo,,bar')).toEqual(['foo', 'bar'])
      expect(urlSearchParamAsArray('foo, , bar')).toEqual(['foo', 'bar'])
    })

    it('should return empty array for null', () => {
      expect(urlSearchParamAsArray(null)).toEqual([])
    })

    it('should return empty array for undefined', () => {
      expect(urlSearchParamAsArray(undefined)).toEqual([])
    })

    it('should return empty array for empty string', () => {
      expect(urlSearchParamAsArray('')).toEqual([])
    })

    it('should return empty array for whitespace-only string', () => {
      expect(urlSearchParamAsArray('   ')).toEqual([])
    })

    it('should handle single value', () => {
      expect(urlSearchParamAsArray('foo')).toEqual(['foo'])
    })

    it('should handle values with spaces but no commas', () => {
      expect(urlSearchParamAsArray('foo bar')).toEqual(['foo bar'])
    })
  })

  describe('urlSearchParamAsBoolean', () => {
    it('should return true for "true" string', () => {
      expect(urlSearchParamAsBoolean('true')).toBe(true)
      expect(urlSearchParamAsBoolean('TRUE')).toBe(true)
      expect(urlSearchParamAsBoolean('True')).toBe(true)
    })

    it('should return true for "1" string', () => {
      expect(urlSearchParamAsBoolean('1')).toBe(true)
    })

    it('should return false for "false" string', () => {
      expect(urlSearchParamAsBoolean('false')).toBe(false)
      expect(urlSearchParamAsBoolean('FALSE')).toBe(false)
    })

    it('should return false for "0" string', () => {
      expect(urlSearchParamAsBoolean('0')).toBe(false)
    })

    it('should return false for other strings', () => {
      expect(urlSearchParamAsBoolean('hello')).toBe(false)
      expect(urlSearchParamAsBoolean('yes')).toBe(false)
      expect(urlSearchParamAsBoolean('no')).toBe(false)
    })

    it('should return default value for null', () => {
      expect(urlSearchParamAsBoolean(null)).toBe(false)
      expect(urlSearchParamAsBoolean(null, { defaultValue: true })).toBe(true)
    })

    it('should return default value for undefined', () => {
      expect(urlSearchParamAsBoolean(undefined)).toBe(false)
      expect(urlSearchParamAsBoolean(undefined, { defaultValue: true })).toBe(
        true,
      )
    })

    it('should trim whitespace before checking', () => {
      expect(urlSearchParamAsBoolean(' true ')).toBe(true)
      expect(urlSearchParamAsBoolean(' 1 ')).toBe(true)
      expect(urlSearchParamAsBoolean(' false ')).toBe(false)
    })

    it('should handle empty string as false', () => {
      expect(urlSearchParamAsBoolean('')).toBe(false)
    })

    it('should use custom default value', () => {
      expect(urlSearchParamAsBoolean(null, { defaultValue: true })).toBe(true)
      expect(urlSearchParamAsBoolean(undefined, { defaultValue: true })).toBe(
        true,
      )
    })
  })

  describe('urlSearchParamsGetArray', () => {
    it('should get multiple values for same key', () => {
      const params = new URLSearchParams()
      params.append('tags', 'foo')
      params.append('tags', 'bar')
      params.append('tags', 'baz')
      expect(urlSearchParamsGetArray(params, 'tags')).toEqual([
        'foo',
        'bar',
        'baz',
      ])
    })

    it('should split comma-separated single value', () => {
      const params = new URLSearchParams('tags=foo,bar,baz')
      expect(urlSearchParamsGetArray(params, 'tags')).toEqual([
        'foo',
        'bar',
        'baz',
      ])
    })

    it('should not split when multiple values exist', () => {
      const params = new URLSearchParams()
      params.append('tags', 'foo,bar')
      params.append('tags', 'baz')
      expect(urlSearchParamsGetArray(params, 'tags')).toEqual([
        'foo,bar',
        'baz',
      ])
    })

    it('should return empty array for missing key', () => {
      const params = new URLSearchParams('foo=bar')
      expect(urlSearchParamsGetArray(params, 'missing')).toEqual([])
    })

    it('should return empty array for null params', () => {
      expect(urlSearchParamsGetArray(null, 'key')).toEqual([])
    })

    it('should return empty array for undefined params', () => {
      expect(urlSearchParamsGetArray(undefined, 'key')).toEqual([])
    })

    it('should handle empty string value', () => {
      const params = new URLSearchParams('key=')
      expect(urlSearchParamsGetArray(params, 'key')).toEqual([''])
    })

    it('should handle single value without comma', () => {
      const params = new URLSearchParams('key=value')
      expect(urlSearchParamsGetArray(params, 'key')).toEqual(['value'])
    })
  })

  describe('urlSearchParamsGetBoolean', () => {
    it('should get boolean from URLSearchParams', () => {
      const params = new URLSearchParams('enabled=true')
      expect(urlSearchParamsGetBoolean(params, 'enabled')).toBe(true)
    })

    it('should handle "1" as true', () => {
      const params = new URLSearchParams('enabled=1')
      expect(urlSearchParamsGetBoolean(params, 'enabled')).toBe(true)
    })

    it('should handle "false" as false', () => {
      const params = new URLSearchParams('enabled=false')
      expect(urlSearchParamsGetBoolean(params, 'enabled')).toBe(false)
    })

    it('should handle "0" as false', () => {
      const params = new URLSearchParams('enabled=0')
      expect(urlSearchParamsGetBoolean(params, 'enabled')).toBe(false)
    })

    it('should return default value for missing key', () => {
      const params = new URLSearchParams('foo=bar')
      expect(urlSearchParamsGetBoolean(params, 'missing')).toBe(false)
      expect(
        urlSearchParamsGetBoolean(params, 'missing', { defaultValue: true }),
      ).toBe(true)
    })

    it('should return default value for null params', () => {
      expect(urlSearchParamsGetBoolean(null, 'key')).toBe(false)
      expect(
        urlSearchParamsGetBoolean(null, 'key', { defaultValue: true }),
      ).toBe(true)
    })

    it('should return default value for undefined params', () => {
      expect(urlSearchParamsGetBoolean(undefined, 'key')).toBe(false)
      expect(
        urlSearchParamsGetBoolean(undefined, 'key', { defaultValue: true }),
      ).toBe(true)
    })

    it('should handle case-insensitive true', () => {
      const params = new URLSearchParams('enabled=TRUE')
      expect(urlSearchParamsGetBoolean(params, 'enabled')).toBe(true)
    })

    it('should handle whitespace', () => {
      const params = new URLSearchParams('enabled=%20true%20')
      expect(urlSearchParamsGetBoolean(params, 'enabled')).toBe(true)
    })

    it('should handle empty string value as false', () => {
      const params = new URLSearchParams('enabled=')
      expect(urlSearchParamsGetBoolean(params, 'enabled')).toBe(false)
    })
  })

  describe('createRelativeUrl', () => {
    it('should create relative URL by removing leading slash', () => {
      expect(createRelativeUrl('/path/to/resource')).toBe('path/to/resource')
    })

    it('should handle path without leading slash', () => {
      expect(createRelativeUrl('path/to/resource')).toBe('path/to/resource')
    })

    it('should prepend base URL when provided', () => {
      expect(createRelativeUrl('/path', { base: 'https://example.com' })).toBe(
        'https://example.com/path',
      )
    })

    it('should add trailing slash to base if missing', () => {
      expect(createRelativeUrl('/path', { base: 'https://example.com' })).toBe(
        'https://example.com/path',
      )
      expect(createRelativeUrl('/path', { base: 'https://example.com/' })).toBe(
        'https://example.com/path',
      )
    })

    it('should handle empty path', () => {
      expect(createRelativeUrl('')).toBe('')
      expect(createRelativeUrl('', { base: 'https://example.com' })).toBe(
        'https://example.com/',
      )
    })

    it('should handle root path', () => {
      expect(createRelativeUrl('/')).toBe('')
      expect(createRelativeUrl('/', { base: 'https://example.com' })).toBe(
        'https://example.com/',
      )
    })

    it('should handle complex paths', () => {
      expect(createRelativeUrl('/path/to/resource?query=1#hash')).toBe(
        'path/to/resource?query=1#hash',
      )
    })

    it('should work with base URLs that have paths', () => {
      expect(
        createRelativeUrl('/resource', { base: 'https://example.com/api' }),
      ).toBe('https://example.com/api/resource')
    })

    it('should handle empty base option', () => {
      expect(createRelativeUrl('/path', { base: '' })).toBe('path')
    })
  })

  describe('urlSearchParamAsString', () => {
    it('should get string value from URLSearchParams', () => {
      const params = new URLSearchParams('name=value')
      expect(urlSearchParamAsString(params, 'name')).toBe('value')
    })

    it('should return default value for missing key', () => {
      const params = new URLSearchParams('foo=bar')
      expect(urlSearchParamAsString(params, 'missing')).toBe('')
      expect(
        urlSearchParamAsString(params, 'missing', { defaultValue: 'default' }),
      ).toBe('default')
    })

    it('should return default value for null params', () => {
      expect(urlSearchParamAsString(null, 'key')).toBe('')
      expect(
        urlSearchParamAsString(null, 'key', { defaultValue: 'default' }),
      ).toBe('default')
    })

    it('should return default value for undefined params', () => {
      expect(urlSearchParamAsString(undefined, 'key')).toBe('')
      expect(
        urlSearchParamAsString(undefined, 'key', { defaultValue: 'default' }),
      ).toBe('default')
    })

    it('should handle empty string value', () => {
      const params = new URLSearchParams('key=')
      expect(urlSearchParamAsString(params, 'key')).toBe('')
    })

    it('should handle special characters in value', () => {
      const params = new URLSearchParams('key=hello%20world')
      expect(urlSearchParamAsString(params, 'key')).toBe('hello world')
    })

    it('should get first value when multiple exist', () => {
      const params = new URLSearchParams()
      params.append('key', 'first')
      params.append('key', 'second')
      expect(urlSearchParamAsString(params, 'key')).toBe('first')
    })

    it('should preserve whitespace in values', () => {
      const params = new URLSearchParams('key=%20value%20')
      expect(urlSearchParamAsString(params, 'key')).toBe(' value ')
    })
  })

  describe('urlSearchParamAsNumber', () => {
    it('should parse integer values', () => {
      const params = new URLSearchParams('count=42')
      expect(urlSearchParamAsNumber(params, 'count')).toBe(42)
    })

    it('should parse negative numbers', () => {
      const params = new URLSearchParams('value=-10')
      expect(urlSearchParamAsNumber(params, 'value')).toBe(-10)
    })

    it('should parse floating point numbers', () => {
      const params = new URLSearchParams('price=19.99')
      expect(urlSearchParamAsNumber(params, 'price')).toBe(19.99)
    })

    it('should parse zero', () => {
      const params = new URLSearchParams('value=0')
      expect(urlSearchParamAsNumber(params, 'value')).toBe(0)
    })

    it('should return default value for invalid numbers', () => {
      const params = new URLSearchParams('value=notanumber')
      expect(urlSearchParamAsNumber(params, 'value')).toBe(0)
      expect(
        urlSearchParamAsNumber(params, 'value', { defaultValue: 42 }),
      ).toBe(42)
    })

    it('should return default value for missing key', () => {
      const params = new URLSearchParams('foo=bar')
      expect(urlSearchParamAsNumber(params, 'missing')).toBe(0)
      expect(
        urlSearchParamAsNumber(params, 'missing', { defaultValue: 100 }),
      ).toBe(100)
    })

    it('should return default value for null params', () => {
      expect(urlSearchParamAsNumber(null, 'key')).toBe(0)
      expect(urlSearchParamAsNumber(null, 'key', { defaultValue: 42 })).toBe(42)
    })

    it('should return default value for undefined params', () => {
      expect(urlSearchParamAsNumber(undefined, 'key')).toBe(0)
      expect(
        urlSearchParamAsNumber(undefined, 'key', { defaultValue: 42 }),
      ).toBe(42)
    })

    it('should return default value for empty string', () => {
      const params = new URLSearchParams('value=')
      expect(urlSearchParamAsNumber(params, 'value')).toBe(0)
    })

    it('should parse scientific notation', () => {
      const params = new URLSearchParams('value=1e3')
      expect(urlSearchParamAsNumber(params, 'value')).toBe(1000)
    })

    it('should parse hex numbers', () => {
      const params = new URLSearchParams('value=0x10')
      expect(urlSearchParamAsNumber(params, 'value')).toBe(16)
    })

    it('should handle Infinity', () => {
      const params = new URLSearchParams('value=Infinity')
      expect(urlSearchParamAsNumber(params, 'value')).toBe(
        Number.POSITIVE_INFINITY,
      )
    })

    it('should handle whitespace around numbers', () => {
      const params = new URLSearchParams('value=%20%2042%20%20')
      expect(urlSearchParamAsNumber(params, 'value')).toBe(42)
    })
  })
})
