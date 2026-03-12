/**
 * Unit tests for error constants.
 *
 * Purpose:
 * Tests the error message constants for Socket CLI.
 *
 * Test Coverage:
 * - Error message constants
 * - Loop sentinel value
 *
 * Related Files:
 * - constants/errors.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  ERROR_NO_MANIFEST_FILES,
  ERROR_NO_PACKAGE_JSON,
  ERROR_NO_REPO_FOUND,
  ERROR_NO_SOCKET_DIR,
  ERROR_UNABLE_RESOLVE_ORG,
  LOOP_SENTINEL,
} from '../../../src/constants/errors.mts'

describe('errors constants', () => {
  describe('error message constants', () => {
    it('has ERROR_NO_MANIFEST_FILES constant', () => {
      expect(ERROR_NO_MANIFEST_FILES).toBe('No manifest files found')
    })

    it('has ERROR_NO_PACKAGE_JSON constant', () => {
      expect(ERROR_NO_PACKAGE_JSON).toBe('No package.json found')
    })

    it('has ERROR_NO_REPO_FOUND constant', () => {
      expect(ERROR_NO_REPO_FOUND).toBe('No repo found')
    })

    it('has ERROR_NO_SOCKET_DIR constant', () => {
      expect(ERROR_NO_SOCKET_DIR).toBe('No .socket directory found')
    })

    it('has ERROR_UNABLE_RESOLVE_ORG constant', () => {
      expect(ERROR_UNABLE_RESOLVE_ORG).toBe(
        'Unable to resolve a Socket account organization',
      )
    })
  })

  describe('loop sentinel', () => {
    it('has LOOP_SENTINEL constant', () => {
      expect(LOOP_SENTINEL).toBe(50_000)
    })

    it('LOOP_SENTINEL is a reasonable limit for tree traversal', () => {
      expect(LOOP_SENTINEL).toBeGreaterThan(1000)
      expect(LOOP_SENTINEL).toBeLessThan(1_000_000)
    })
  })
})
