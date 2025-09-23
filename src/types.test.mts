import { describe, expect, it } from 'vitest'

import type {
  CResult,
  InvalidResult,
  SocketCliConfigObject,
  SocketconfigAny,
  ValidResult,
} from './types.mts'

describe('types', () => {
  describe('CResult type', () => {
    it('can represent a valid result', () => {
      const validResult: ValidResult<string> = {
        ok: true,
        value: 'success',
      }

      expect(validResult.ok).toBe(true)
      expect(validResult.value).toBe('success')
    })

    it('can represent an invalid result', () => {
      const invalidResult: InvalidResult = {
        ok: false,
        error: new Error('Something went wrong'),
      }

      expect(invalidResult.ok).toBe(false)
      expect(invalidResult.error).toBeInstanceOf(Error)
      expect(invalidResult.error.message).toBe('Something went wrong')
    })

    it('can be used as a union type', () => {
      function processResult(value: number): CResult<string> {
        if (value > 0) {
          return { ok: true, value: `Positive: ${value}` }
        }
        return { ok: false, error: new Error('Value must be positive') }
      }

      const success = processResult(5)
      const failure = processResult(-1)

      if (success.ok) {
        expect(success.value).toBe('Positive: 5')
      }

      if (!failure.ok) {
        expect(failure.error.message).toBe('Value must be positive')
      }
    })
  })

  describe('SocketCliConfigObject type', () => {
    it('can represent a minimal config', () => {
      const config: SocketCliConfigObject = {}

      expect(config.baseURL).toBeUndefined()
      expect(config.proxy).toBeUndefined()
      expect(config.reportProvider).toBeUndefined()
    })

    it('can represent a full config', () => {
      const config: SocketCliConfigObject = {
        baseURL: 'https://api.example.com',
        proxy: 'http://proxy.example.com:8080',
        reportProvider: 'custom-provider',
        token: 'test-token',
        outputDefault: {
          format: ['text'],
        },
        outputStderr: false,
        issueRules: {
          'high-severity': {
            action: 'error',
          },
        },
        projectIgnorePaths: ['node_modules', 'dist'],
        manifestFiles: {
          package: ['package.json'],
        },
        enforcedOrgs: {
          'org-name': {
            type: ['prod'],
          },
        },
      }

      expect(config.baseURL).toBe('https://api.example.com')
      expect(config.proxy).toBe('http://proxy.example.com:8080')
      expect(config.token).toBe('test-token')
      expect(config.outputDefault?.format).toEqual(['text'])
    })

    it('can have various output formats', () => {
      const configs: SocketCliConfigObject[] = [
        { outputDefault: { format: ['text'] } },
        { outputDefault: { format: ['json'] } },
        { outputDefault: { format: ['markdown'] } },
        { outputDefault: { format: ['text', 'json'] } },
      ]

      for (const config of configs) {
        expect(config.outputDefault).toBeDefined()
        expect(Array.isArray(config.outputDefault?.format)).toBe(true)
      }
    })
  })

  describe('SocketconfigAny type', () => {
    it('can represent string or object config', () => {
      const stringConfig: SocketconfigAny = 'simple-string-config'
      const objectConfig: SocketconfigAny = {
        baseURL: 'https://api.example.com',
      }

      expect(typeof stringConfig).toBe('string')
      expect(typeof objectConfig).toBe('object')
    })
  })

  describe('Type guards and utilities', () => {
    it('can check if result is valid', () => {
      function isValidResult<T>(result: CResult<T>): result is ValidResult<T> {
        return result.ok === true
      }

      const valid: CResult<number> = { ok: true, value: 42 }
      const invalid: CResult<number> = { ok: false, error: new Error('Failed') }

      expect(isValidResult(valid)).toBe(true)
      expect(isValidResult(invalid)).toBe(false)
    })

    it('can extract value from valid result', () => {
      function unwrapResult<T>(result: CResult<T>): T {
        if (result.ok) {
          return result.value
        }
        throw result.error
      }

      const valid: CResult<string> = { ok: true, value: 'success' }
      expect(unwrapResult(valid)).toBe('success')

      const invalid: CResult<string> = { ok: false, error: new Error('Failed') }
      expect(() => unwrapResult(invalid)).toThrow('Failed')
    })
  })
})
