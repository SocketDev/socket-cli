/** @fileoverview Tests for query parameter normalization and URL encoding. */
import { describe, expect, it } from 'vitest'

import { queryToSearchParams } from '../src/index'

describe('Query Parameter Normalization', () => {
  describe('queryToSearchParams', () => {
    it('should convert defaultBranch parameter to default_branch', () => {
      const params = { defaultBranch: 'main', other: 'value' }
      const result = queryToSearchParams(params)

      expect(result.toString()).toBe('default_branch=main&other=value')
    })

    it('should convert perPage parameter to per_page', () => {
      const params = { perPage: '50', other: 'value' }
      const result = queryToSearchParams(params)

      expect(result.toString()).toBe('per_page=50&other=value')
    })

    it('should filter out empty string values', () => {
      const params = { key1: '', key2: 'value', key3: '' }
      const result = queryToSearchParams(params)

      expect(result.toString()).toBe('key2=value')
    })

    it('should handle multiple parameters including defaultBranch', () => {
      const params = {
        defaultBranch: 'develop',
        name: 'test-repo',
        active: 'true',
        count: '10',
      }
      const result = queryToSearchParams(params)
      const resultString = result.toString()

      expect(resultString).toContain('default_branch=develop')
      expect(resultString).toContain('name=test-repo')
      expect(resultString).toContain('active=true')
      expect(resultString).toContain('count=10')
    })

    it('should handle empty defaultBranch parameter', () => {
      const params = { defaultBranch: '' }
      const result = queryToSearchParams(params)

      // Empty strings are filtered out by the function
      expect(result.toString()).toBe('')
    })

    it('should handle defaultBranch with special characters', () => {
      const params = { defaultBranch: 'feature/test-branch' }
      const result = queryToSearchParams(params)

      expect(result.toString()).toContain(
        'default_branch=feature%2Ftest-branch',
      )
    })

    it('should not affect other parameters', () => {
      const params = {
        regularParam: 'value',
        anotherParam: '123',
        defaultBranch: 'master',
      }
      const result = queryToSearchParams(params)
      const resultString = result.toString()

      expect(resultString).toContain('regularParam=value')
      expect(resultString).toContain('anotherParam=123')
      expect(resultString).toContain('default_branch=master')
      expect(resultString).not.toContain('defaultBranch=')
    })
  })
})
