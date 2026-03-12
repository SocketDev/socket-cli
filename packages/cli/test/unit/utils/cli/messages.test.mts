/**
 * Unit tests for CLI message constants.
 *
 * Purpose:
 * Tests the message templates used throughout the CLI.
 *
 * Test Coverage:
 * - Static message values
 * - Message template functions
 * - All message categories
 *
 * Related Files:
 * - utils/cli/messages.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  AUTH_MESSAGES,
  CONFIG_MESSAGES,
  FILE_MESSAGES,
  GENERAL_MESSAGES,
  INPUT_MESSAGES,
  ORG_MESSAGES,
  PACKAGE_MESSAGES,
  REPO_MESSAGES,
  RESOURCE_MESSAGES,
  SCAN_MESSAGES,
  SDK_MESSAGES,
  VALIDATION_MESSAGES,
} from '../../../../src/utils/cli/messages.mts'

describe('cli-messages', () => {
  describe('AUTH_MESSAGES', () => {
    it('has NO_TOKEN message', () => {
      expect(AUTH_MESSAGES.NO_TOKEN).toContain('Socket API token')
    })

    it('has INVALID_TOKEN message', () => {
      expect(AUTH_MESSAGES.INVALID_TOKEN).toBe('Invalid API token')
    })

    it('has UNAUTHORIZED message', () => {
      expect(AUTH_MESSAGES.UNAUTHORIZED).toBe('Unauthorized')
    })
  })

  describe('INPUT_MESSAGES', () => {
    it('has static messages', () => {
      expect(INPUT_MESSAGES.NO_ORG_SLUG).toContain('organization slug')
      expect(INPUT_MESSAGES.NO_PACKAGE).toContain('package')
    })

    it('MISSING_PARAM returns formatted message', () => {
      const message = INPUT_MESSAGES.MISSING_PARAM('apiToken')
      expect(message).toBe('Missing required parameter: apiToken')
    })

    it('INVALID_PARAM returns formatted message with reason', () => {
      const message = INPUT_MESSAGES.INVALID_PARAM('email', 'must be valid')
      expect(message).toBe('Invalid email: must be valid')
    })

    it('INVALID_PARAM returns message without reason', () => {
      const message = INPUT_MESSAGES.INVALID_PARAM('email')
      expect(message).toBe('Invalid email')
    })
  })

  describe('SDK_MESSAGES', () => {
    it('has all SDK error messages', () => {
      expect(SDK_MESSAGES.SETUP_FAILED).toBe('Failed to setup SDK')
      expect(SDK_MESSAGES.API_ERROR).toBe('API request failed')
      expect(SDK_MESSAGES.NETWORK_ERROR).toBe('Network error')
    })
  })

  describe('RESOURCE_MESSAGES', () => {
    it('NOT_FOUND formats resource name', () => {
      expect(RESOURCE_MESSAGES.NOT_FOUND('Scan')).toBe('Scan not found')
    })

    it('CREATED formats resource name', () => {
      expect(RESOURCE_MESSAGES.CREATED('Repository')).toBe(
        'Repository created successfully',
      )
    })

    it('FAILED_TO_FETCH formats resource name', () => {
      expect(RESOURCE_MESSAGES.FAILED_TO_FETCH('package info')).toBe(
        'Failed to fetch package info',
      )
    })
  })

  describe('REPO_MESSAGES', () => {
    it('REPO_CREATED formats repo name', () => {
      expect(REPO_MESSAGES.REPO_CREATED('my-repo')).toContain('my-repo')
      expect(REPO_MESSAGES.REPO_CREATED('my-repo')).toContain('created')
    })

    it('REPO_DELETED formats repo name', () => {
      expect(REPO_MESSAGES.REPO_DELETED('my-repo')).toContain('deleted')
    })
  })

  describe('SCAN_MESSAGES', () => {
    it('SCAN_CREATED formats scan id', () => {
      expect(SCAN_MESSAGES.SCAN_CREATED('scan-123')).toContain('scan-123')
    })

    it('has scan status messages', () => {
      expect(SCAN_MESSAGES.SCAN_IN_PROGRESS).toBe('Scan in progress')
      expect(SCAN_MESSAGES.SCAN_COMPLETE).toBe('Scan complete')
    })
  })

  describe('PACKAGE_MESSAGES', () => {
    it('INVALID_GHSA formats GHSA id', () => {
      expect(PACKAGE_MESSAGES.INVALID_GHSA('bad-ghsa')).toContain('bad-ghsa')
    })

    it('INVALID_CVE formats CVE id', () => {
      expect(PACKAGE_MESSAGES.INVALID_CVE('bad-cve')).toContain('bad-cve')
    })

    it('MISSING_RESPONSE formats purl', () => {
      expect(PACKAGE_MESSAGES.MISSING_RESPONSE('pkg:npm/lodash')).toContain(
        'pkg:npm/lodash',
      )
    })
  })

  describe('ORG_MESSAGES', () => {
    it('DATA_NOT_AVAILABLE formats org scope', () => {
      expect(ORG_MESSAGES.DATA_NOT_AVAILABLE('org')).toContain('organization')
    })

    it('DATA_NOT_AVAILABLE formats repo scope', () => {
      expect(ORG_MESSAGES.DATA_NOT_AVAILABLE('repo')).toContain('repository')
    })
  })

  describe('FILE_MESSAGES', () => {
    it('FILE_NOT_FOUND formats path', () => {
      expect(FILE_MESSAGES.FILE_NOT_FOUND('/path/to/file')).toContain(
        '/path/to/file',
      )
    })

    it('DIRECTORY_NOT_FOUND formats path', () => {
      expect(FILE_MESSAGES.DIRECTORY_NOT_FOUND('/path/to/dir')).toContain(
        '/path/to/dir',
      )
    })
  })

  describe('CONFIG_MESSAGES', () => {
    it('MISSING_ENV_VAR formats variable names', () => {
      expect(CONFIG_MESSAGES.MISSING_ENV_VAR('API_KEY, SECRET')).toContain(
        'API_KEY',
      )
    })
  })

  describe('GENERAL_MESSAGES', () => {
    it('OPERATION_FAILED formats operation', () => {
      expect(GENERAL_MESSAGES.OPERATION_FAILED('create scan')).toBe(
        'Failed to create scan',
      )
    })

    it('OPERATION_SUCCESS formats operation', () => {
      expect(GENERAL_MESSAGES.OPERATION_SUCCESS('deleted')).toBe(
        'Successfully deleted',
      )
    })
  })

  describe('VALIDATION_MESSAGES', () => {
    it('ENUM_INVALID formats options', () => {
      const message = VALIDATION_MESSAGES.ENUM_INVALID('format', [
        'json',
        'text',
      ])
      expect(message).toContain('format')
      expect(message).toContain('json, text')
    })

    it('NUMBER_OUT_OF_RANGE formats range', () => {
      const message = VALIDATION_MESSAGES.NUMBER_OUT_OF_RANGE('count', 1, 100)
      expect(message).toContain('count')
      expect(message).toContain('1')
      expect(message).toContain('100')
    })
  })
})
