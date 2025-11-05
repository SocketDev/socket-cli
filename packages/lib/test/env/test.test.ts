/**
 * @fileoverview Unit tests for test environment variable getters and detection.
 *
 * Tests isTest() for detecting test execution environment.
 * Checks NODE_ENV=test or test runner indicators (Vitest, Jest, etc.).
 * Uses rewire for test isolation. Used for conditional test-only behavior.
 */

import {
  getJestWorkerId,
  getVitest,
  isTest,
} from '@socketsecurity/lib/env/test'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/test', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getJestWorkerId', () => {
    it('should return JEST_WORKER_ID when set', () => {
      setEnv('JEST_WORKER_ID', '1')
      expect(getJestWorkerId()).toBe('1')
    })

    it('should return empty string when JEST_WORKER_ID is not set', () => {
      clearEnv('JEST_WORKER_ID')
      expect(getJestWorkerId()).toBe('')
    })

    it('should handle numeric worker IDs', () => {
      setEnv('JEST_WORKER_ID', '2')
      expect(getJestWorkerId()).toBe('2')

      setEnv('JEST_WORKER_ID', '10')
      expect(getJestWorkerId()).toBe('10')
    })

    it('should handle empty string', () => {
      setEnv('JEST_WORKER_ID', '')
      expect(getJestWorkerId()).toBe('')
    })

    it('should handle updating worker ID', () => {
      setEnv('JEST_WORKER_ID', '1')
      expect(getJestWorkerId()).toBe('1')

      setEnv('JEST_WORKER_ID', '2')
      expect(getJestWorkerId()).toBe('2')
    })

    it('should handle consecutive reads', () => {
      setEnv('JEST_WORKER_ID', '1')
      expect(getJestWorkerId()).toBe('1')
      expect(getJestWorkerId()).toBe('1')
      expect(getJestWorkerId()).toBe('1')
    })
  })

  describe('getVitest', () => {
    it('should return true when VITEST is set to "true"', () => {
      setEnv('VITEST', 'true')
      expect(getVitest()).toBe(true)
    })

    it('should return true when VITEST is set to "1"', () => {
      setEnv('VITEST', '1')
      expect(getVitest()).toBe(true)
    })

    it('should return true when VITEST is set to "yes"', () => {
      setEnv('VITEST', 'yes')
      expect(getVitest()).toBe(true)
    })

    it('should return false when VITEST is not set', () => {
      setEnv('VITEST', '')
      expect(getVitest()).toBe(false)
    })

    it('should return false when VITEST is set to "false"', () => {
      setEnv('VITEST', 'false')
      expect(getVitest()).toBe(false)
    })

    it('should return false when VITEST is empty string', () => {
      setEnv('VITEST', '')
      expect(getVitest()).toBe(false)
    })

    it('should handle consecutive reads', () => {
      setEnv('VITEST', 'true')
      expect(getVitest()).toBe(true)
      expect(getVitest()).toBe(true)
      expect(getVitest()).toBe(true)
    })
  })

  describe('isTest', () => {
    it('should return true when NODE_ENV is test', () => {
      setEnv('NODE_ENV', 'test')
      expect(isTest()).toBe(true)
    })

    it('should return true when VITEST is true', () => {
      setEnv('VITEST', 'true')
      expect(isTest()).toBe(true)
    })

    it('should return true when JEST_WORKER_ID is set', () => {
      setEnv('JEST_WORKER_ID', '1')
      expect(isTest()).toBe(true)
    })

    it('should return false when none of the test indicators are set', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')
      expect(isTest()).toBe(false)
    })

    it('should return false when NODE_ENV is production', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')
      expect(isTest()).toBe(false)
    })

    it('should return false when NODE_ENV is development', () => {
      setEnv('NODE_ENV', 'development')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')
      expect(isTest()).toBe(false)
    })

    it('should return true when multiple test indicators are set', () => {
      setEnv('NODE_ENV', 'test')
      setEnv('VITEST', 'true')
      setEnv('JEST_WORKER_ID', '1')
      expect(isTest()).toBe(true)
    })

    it('should return true for Jest environment only', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '2')
      expect(isTest()).toBe(true)
    })

    it('should return true for Vitest environment only', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '1')
      setEnv('JEST_WORKER_ID', '')
      expect(isTest()).toBe(true)
    })

    it('should return true for NODE_ENV test only', () => {
      setEnv('NODE_ENV', 'test')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')
      expect(isTest()).toBe(true)
    })

    it('should handle consecutive reads', () => {
      setEnv('NODE_ENV', 'test')
      expect(isTest()).toBe(true)
      expect(isTest()).toBe(true)
      expect(isTest()).toBe(true)
    })

    it('should return true when VITEST is yes', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', 'yes')
      setEnv('JEST_WORKER_ID', '')
      expect(isTest()).toBe(true)
    })

    it('should handle transition from test to non-test', () => {
      setEnv('NODE_ENV', 'test')
      expect(isTest()).toBe(true)

      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')
      expect(isTest()).toBe(false)
    })

    it('should handle transition from non-test to test', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')
      expect(isTest()).toBe(false)

      setEnv('NODE_ENV', 'test')
      expect(isTest()).toBe(true)
    })

    it('should return true even with empty JEST_WORKER_ID', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')
      // Empty string is falsy, so isTest should be false
      expect(isTest()).toBe(false)
    })

    it('should handle Jest worker ID 0', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '0')
      // '0' is truthy as a string, so isTest should be true
      expect(isTest()).toBe(true)
    })

    it('should handle uppercase NODE_ENV', () => {
      setEnv('NODE_ENV', 'TEST')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')
      // Should be false because comparison is case-sensitive
      expect(isTest()).toBe(false)
    })

    it('should handle mixed case VITEST', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', 'True')
      setEnv('JEST_WORKER_ID', '')
      // envAsBoolean is case-insensitive
      expect(isTest()).toBe(true)
    })

    it('should handle clearing all test indicators', () => {
      setEnv('NODE_ENV', 'test')
      setEnv('VITEST', 'true')
      setEnv('JEST_WORKER_ID', '1')
      expect(isTest()).toBe(true)

      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')
      expect(isTest()).toBe(false)
    })
  })

  describe('test environment interaction', () => {
    it('should detect Jest test environment', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '1')

      expect(getJestWorkerId()).toBe('1')
      expect(getVitest()).toBe(false)
      expect(isTest()).toBe(true)
    })

    it('should detect Vitest test environment', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', 'true')
      setEnv('JEST_WORKER_ID', '')

      expect(getJestWorkerId()).toBe('')
      expect(getVitest()).toBe(true)
      expect(isTest()).toBe(true)
    })

    it('should detect NODE_ENV test environment', () => {
      setEnv('NODE_ENV', 'test')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')

      expect(getJestWorkerId()).toBe('')
      expect(getVitest()).toBe(false)
      expect(isTest()).toBe(true)
    })

    it('should detect non-test environment', () => {
      setEnv('NODE_ENV', 'production')
      setEnv('VITEST', '')
      setEnv('JEST_WORKER_ID', '')

      expect(getJestWorkerId()).toBe('')
      expect(getVitest()).toBe(false)
      expect(isTest()).toBe(false)
    })
  })
})
