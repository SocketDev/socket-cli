/** @fileoverview Tests for promiseWithResolvers utility function coverage. */
import { describe, expect, it } from 'vitest'

import { promiseWithResolvers } from '../src/index'

describe('Utility Functions - Promise Resolvers', () => {
  describe('promiseWithResolvers', () => {
    it('should return promise, resolve, and reject functions', () => {
      const { promise, reject, resolve } = promiseWithResolvers<string>()

      expect(promise).toBeInstanceOf(Promise)
      expect(typeof resolve).toBe('function')
      expect(typeof reject).toBe('function')
    })

    it('should resolve promise with provided value', async () => {
      const { promise, resolve } = promiseWithResolvers<number>()

      resolve(42)

      await expect(promise).resolves.toBe(42)
    })

    it('should reject promise with provided error', async () => {
      const { promise, reject } = promiseWithResolvers<string>()
      const error = new Error('Test error')

      reject(error)

      await expect(promise).rejects.toBe(error)
    })

    it('should work with complex types', async () => {
      const { promise, resolve } = promiseWithResolvers<{ data: string[] }>()
      const testData = { data: ['test', 'data'] }

      resolve(testData)

      const result = await promise
      expect(result).toEqual(testData)
      expect(result.data).toHaveLength(2)
    })
  })
})
