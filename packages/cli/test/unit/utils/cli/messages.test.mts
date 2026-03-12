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

    it('has INSUFFICIENT_PERMISSIONS message', () => {
      expect(AUTH_MESSAGES.INSUFFICIENT_PERMISSIONS).toBe(
        'Insufficient permissions',
      )
    })

    it('has FORBIDDEN message', () => {
      expect(AUTH_MESSAGES.FORBIDDEN).toBe('User does not have access')
    })
  })

  describe('INPUT_MESSAGES', () => {
    it('has static messages', () => {
      expect(INPUT_MESSAGES.NO_ORG_SLUG).toContain('organization slug')
      expect(INPUT_MESSAGES.NO_PACKAGE).toContain('package')
    })

    it('has NO_REPO_NAME message', () => {
      expect(INPUT_MESSAGES.NO_REPO_NAME).toContain('repository name')
    })

    it('has INVALID_TIME_FILTER message', () => {
      expect(INPUT_MESSAGES.INVALID_TIME_FILTER).toContain('7, 30 or 90')
    })

    it('has INVALID_FORMAT message', () => {
      expect(INPUT_MESSAGES.INVALID_FORMAT).toContain('json')
      expect(INPUT_MESSAGES.INVALID_FORMAT).toContain('markdown')
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
      expect(SDK_MESSAGES.MISSING_CONFIG).toBe('Invalid configuration')
      expect(SDK_MESSAGES.CONNECTION_TIMEOUT).toBe('Connection timeout')
    })
  })

  describe('RESOURCE_MESSAGES', () => {
    it('NOT_FOUND formats resource name', () => {
      expect(RESOURCE_MESSAGES.NOT_FOUND('Scan')).toBe('Scan not found')
    })

    it('ALREADY_EXISTS formats resource name', () => {
      expect(RESOURCE_MESSAGES.ALREADY_EXISTS('Scan')).toBe('Scan already exists')
    })

    it('CREATED formats resource name', () => {
      expect(RESOURCE_MESSAGES.CREATED('Repository')).toBe(
        'Repository created successfully',
      )
    })

    it('UPDATED formats resource name', () => {
      expect(RESOURCE_MESSAGES.UPDATED('Repository')).toBe(
        'Repository updated successfully',
      )
    })

    it('DELETED formats resource name', () => {
      expect(RESOURCE_MESSAGES.DELETED('Repository')).toBe(
        'Repository deleted successfully',
      )
    })

    it('FAILED_TO_CREATE formats resource name', () => {
      expect(RESOURCE_MESSAGES.FAILED_TO_CREATE('package')).toBe(
        'Failed to create package',
      )
    })

    it('FAILED_TO_UPDATE formats resource name', () => {
      expect(RESOURCE_MESSAGES.FAILED_TO_UPDATE('package')).toBe(
        'Failed to update package',
      )
    })

    it('FAILED_TO_DELETE formats resource name', () => {
      expect(RESOURCE_MESSAGES.FAILED_TO_DELETE('package')).toBe(
        'Failed to delete package',
      )
    })

    it('FAILED_TO_FETCH formats resource name', () => {
      expect(RESOURCE_MESSAGES.FAILED_TO_FETCH('package info')).toBe(
        'Failed to fetch package info',
      )
    })
  })

  describe('REPO_MESSAGES', () => {
    it('has static messages', () => {
      expect(REPO_MESSAGES.NO_REPOS_FOUND).toBe('No repositories found')
      expect(REPO_MESSAGES.REPO_NOT_FOUND).toBe('Repository not found')
    })

    it('REPO_CREATED formats repo name', () => {
      expect(REPO_MESSAGES.REPO_CREATED('my-repo')).toContain('my-repo')
      expect(REPO_MESSAGES.REPO_CREATED('my-repo')).toContain('created')
    })

    it('REPO_UPDATED formats repo name', () => {
      expect(REPO_MESSAGES.REPO_UPDATED('my-repo')).toContain('my-repo')
      expect(REPO_MESSAGES.REPO_UPDATED('my-repo')).toContain('updated')
    })

    it('REPO_DELETED formats repo name', () => {
      expect(REPO_MESSAGES.REPO_DELETED('my-repo')).toContain('deleted')
    })
  })

  describe('SCAN_MESSAGES', () => {
    it('has static messages', () => {
      expect(SCAN_MESSAGES.NO_SCANS_FOUND).toBe('No scans found')
      expect(SCAN_MESSAGES.SCAN_NOT_FOUND).toBe('Scan not found')
    })

    it('SCAN_CREATED formats scan id', () => {
      expect(SCAN_MESSAGES.SCAN_CREATED('scan-123')).toContain('scan-123')
    })

    it('SCAN_DELETED formats scan id', () => {
      expect(SCAN_MESSAGES.SCAN_DELETED('scan-123')).toContain('scan-123')
      expect(SCAN_MESSAGES.SCAN_DELETED('scan-123')).toContain('deleted')
    })

    it('has scan status messages', () => {
      expect(SCAN_MESSAGES.SCAN_IN_PROGRESS).toBe('Scan in progress')
      expect(SCAN_MESSAGES.SCAN_COMPLETE).toBe('Scan complete')
    })
  })

  describe('PACKAGE_MESSAGES', () => {
    it('has static messages', () => {
      expect(PACKAGE_MESSAGES.NO_PACKAGE_FOUND).toBe('Package not found')
      expect(PACKAGE_MESSAGES.NO_GHSA_FOUND).toBe('No GHSAs found')
      expect(PACKAGE_MESSAGES.NO_CVE_FOUND).toBe('CVE not found')
      expect(PACKAGE_MESSAGES.INVALID_PURL).toBe('Invalid package URL (purl)')
      expect(PACKAGE_MESSAGES.NO_CAPABILITIES).toContain('No capabilities')
    })

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
    it('has static messages', () => {
      expect(ORG_MESSAGES.NO_ORGS_FOUND).toBe('No organizations found')
      expect(ORG_MESSAGES.ORG_NOT_FOUND).toBe('Organization not found')
    })

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

    it('FILE_READ_ERROR formats path', () => {
      expect(FILE_MESSAGES.FILE_READ_ERROR('/path/to/file')).toBe(
        'Failed to read file: /path/to/file',
      )
    })

    it('FILE_WRITE_ERROR formats path', () => {
      expect(FILE_MESSAGES.FILE_WRITE_ERROR('/path/to/file')).toBe(
        'Failed to write file: /path/to/file',
      )
    })

    it('has FILE_WRITE_FAILURE message', () => {
      expect(FILE_MESSAGES.FILE_WRITE_FAILURE).toBe('File Write Failure')
    })

    it('DIRECTORY_NOT_FOUND formats path', () => {
      expect(FILE_MESSAGES.DIRECTORY_NOT_FOUND('/path/to/dir')).toContain(
        '/path/to/dir',
      )
    })

    it('has NO_SOCKET_DIR message', () => {
      expect(FILE_MESSAGES.NO_SOCKET_DIR).toBe('No .socket directory found')
    })
  })

  describe('CONFIG_MESSAGES', () => {
    it('has UNSUPPORTED_OPERATION message', () => {
      expect(CONFIG_MESSAGES.UNSUPPORTED_OPERATION).toBe('Unsupported')
    })

    it('MISSING_ENV_VAR formats variable names', () => {
      expect(CONFIG_MESSAGES.MISSING_ENV_VAR('API_KEY, SECRET')).toContain(
        'API_KEY',
      )
    })

    it('has INVALID_CONFIG message', () => {
      expect(CONFIG_MESSAGES.INVALID_CONFIG).toBe('Invalid configuration')
    })

    it('has CONFIG_UPDATED message', () => {
      expect(CONFIG_MESSAGES.CONFIG_UPDATED).toBe('Configuration updated')
    })

    it('has SOURCE_NOT_FOUND message', () => {
      expect(CONFIG_MESSAGES.SOURCE_NOT_FOUND).toBe('Source not found.')
    })
  })

  describe('GENERAL_MESSAGES', () => {
    it('has SUCCESS message', () => {
      expect(GENERAL_MESSAGES.SUCCESS).toBe('OK')
    })

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

    it('LEGACY_FLAGS_DEPRECATED formats guide URL', () => {
      const guideUrl = 'https://docs.socket.dev/guide'
      expect(GENERAL_MESSAGES.LEGACY_FLAGS_DEPRECATED(guideUrl)).toBe(
        `Legacy flags are no longer supported. See the ${guideUrl}.`,
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

    it('STRING_REQUIRED formats name', () => {
      expect(VALIDATION_MESSAGES.STRING_REQUIRED('username')).toBe(
        'username is required',
      )
    })

    it('STRING_EMPTY formats name', () => {
      expect(VALIDATION_MESSAGES.STRING_EMPTY('email')).toBe(
        'email cannot be empty',
      )
    })

    it('NUMBER_INVALID formats name', () => {
      expect(VALIDATION_MESSAGES.NUMBER_INVALID('age')).toBe(
        'age must be a number',
      )
    })

    it('NUMBER_OUT_OF_RANGE formats range', () => {
      const message = VALIDATION_MESSAGES.NUMBER_OUT_OF_RANGE('count', 1, 100)
      expect(message).toContain('count')
      expect(message).toContain('1')
      expect(message).toContain('100')
    })
  })
})
