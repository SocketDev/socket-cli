/**
 * @fileoverview Unit tests for PRE_COMMIT environment variable getter.
 *
 * Tests getPreCommit() for detecting pre-commit hook execution.
 * Returns boolean indicating if running in pre-commit context (PRE_COMMIT=1).
 * Uses rewire for test isolation. Used for conditional behavior in Git hooks.
 */

import { getPreCommit } from '@socketsecurity/lib/env/pre-commit'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/pre-commit', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getPreCommit', () => {
    it('should return true when PRE_COMMIT is set to "true"', () => {
      setEnv('PRE_COMMIT', 'true')
      expect(getPreCommit()).toBe(true)
    })

    it('should return true when PRE_COMMIT is set to "TRUE"', () => {
      setEnv('PRE_COMMIT', 'TRUE')
      expect(getPreCommit()).toBe(true)
    })

    it('should return true when PRE_COMMIT is set to "1"', () => {
      setEnv('PRE_COMMIT', '1')
      expect(getPreCommit()).toBe(true)
    })

    it('should return true when PRE_COMMIT is set to "yes"', () => {
      setEnv('PRE_COMMIT', 'yes')
      expect(getPreCommit()).toBe(true)
    })

    it('should return true when PRE_COMMIT is set to "YES"', () => {
      setEnv('PRE_COMMIT', 'YES')
      expect(getPreCommit()).toBe(true)
    })

    it('should return false when PRE_COMMIT is not set', () => {
      clearEnv('PRE_COMMIT')
      expect(getPreCommit()).toBe(false)
    })

    it('should return false when PRE_COMMIT is set to "false"', () => {
      setEnv('PRE_COMMIT', 'false')
      expect(getPreCommit()).toBe(false)
    })

    it('should return false when PRE_COMMIT is set to "0"', () => {
      setEnv('PRE_COMMIT', '0')
      expect(getPreCommit()).toBe(false)
    })

    it('should return false when PRE_COMMIT is set to "no"', () => {
      setEnv('PRE_COMMIT', 'no')
      expect(getPreCommit()).toBe(false)
    })

    it('should return false when PRE_COMMIT is empty string', () => {
      setEnv('PRE_COMMIT', '')
      expect(getPreCommit()).toBe(false)
    })

    it('should handle mixed case true', () => {
      setEnv('PRE_COMMIT', 'True')
      expect(getPreCommit()).toBe(true)
    })

    it('should handle mixed case yes', () => {
      setEnv('PRE_COMMIT', 'Yes')
      expect(getPreCommit()).toBe(true)
    })

    it('should handle arbitrary strings as false', () => {
      setEnv('PRE_COMMIT', 'maybe')
      expect(getPreCommit()).toBe(false)
    })

    it('should handle updating PRE_COMMIT value from false to true', () => {
      setEnv('PRE_COMMIT', 'false')
      expect(getPreCommit()).toBe(false)

      setEnv('PRE_COMMIT', 'true')
      expect(getPreCommit()).toBe(true)
    })

    it('should handle updating PRE_COMMIT value from true to false', () => {
      setEnv('PRE_COMMIT', 'true')
      expect(getPreCommit()).toBe(true)

      setEnv('PRE_COMMIT', 'false')
      expect(getPreCommit()).toBe(false)
    })

    it('should handle clearing and re-setting PRE_COMMIT', () => {
      setEnv('PRE_COMMIT', 'true')
      expect(getPreCommit()).toBe(true)

      clearEnv('PRE_COMMIT')
      expect(getPreCommit()).toBe(false)

      setEnv('PRE_COMMIT', '1')
      expect(getPreCommit()).toBe(true)
    })

    it('should handle consecutive reads', () => {
      setEnv('PRE_COMMIT', 'true')
      expect(getPreCommit()).toBe(true)
      expect(getPreCommit()).toBe(true)
      expect(getPreCommit()).toBe(true)
    })

    it('should handle numeric strings other than 1', () => {
      setEnv('PRE_COMMIT', '2')
      expect(getPreCommit()).toBe(false)

      setEnv('PRE_COMMIT', '100')
      expect(getPreCommit()).toBe(false)
    })

    it('should handle whitespace in values', () => {
      setEnv('PRE_COMMIT', ' true ')
      expect(getPreCommit()).toBe(false) // whitespace makes it not match

      setEnv('PRE_COMMIT', 'true')
      expect(getPreCommit()).toBe(true)
    })

    it('should be case-insensitive for true', () => {
      setEnv('PRE_COMMIT', 'tRuE')
      expect(getPreCommit()).toBe(true)
    })

    it('should be case-insensitive for yes', () => {
      setEnv('PRE_COMMIT', 'yEs')
      expect(getPreCommit()).toBe(true)
    })

    it('should handle special characters', () => {
      setEnv('PRE_COMMIT', 'true!')
      expect(getPreCommit()).toBe(false)
    })

    it('should handle Husky pre-commit context', () => {
      setEnv('PRE_COMMIT', '1')
      expect(getPreCommit()).toBe(true)
    })

    it('should handle pre-commit framework context', () => {
      setEnv('PRE_COMMIT', 'true')
      expect(getPreCommit()).toBe(true)
    })

    it('should handle Git hook context', () => {
      setEnv('PRE_COMMIT', 'yes')
      expect(getPreCommit()).toBe(true)
    })
  })
})
