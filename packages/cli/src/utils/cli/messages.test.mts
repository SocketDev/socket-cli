/**
 * @fileoverview Tests for CLI messages.
 * Validates message templates and consistency across the CLI.
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
} from './messages.mts'

describe('messages', () => {
  describe('AUTH_MESSAGES', () => {
    it('should have all required auth messages', () => {
      expect(AUTH_MESSAGES.NO_TOKEN).toBeTruthy()
      expect(AUTH_MESSAGES.INVALID_TOKEN).toBeTruthy()
      expect(AUTH_MESSAGES.UNAUTHORIZED).toBeTruthy()
      expect(AUTH_MESSAGES.INSUFFICIENT_PERMISSIONS).toBeTruthy()
      expect(AUTH_MESSAGES.FORBIDDEN).toBeTruthy()
    })

    it('should have descriptive messages', () => {
      expect(AUTH_MESSAGES.NO_TOKEN).toContain('Socket API token')
      expect(AUTH_MESSAGES.INVALID_TOKEN).toContain('Invalid')
      expect(AUTH_MESSAGES.UNAUTHORIZED).toContain('Unauthorized')
      expect(AUTH_MESSAGES.FORBIDDEN).toContain('access')
    })

    it('should not end with periods', () => {
      // CLI error messages typically don't end with periods
      expect(AUTH_MESSAGES.NO_TOKEN).not.toMatch(/\.$/u)
      expect(AUTH_MESSAGES.INVALID_TOKEN).not.toMatch(/\.$/u)
      expect(AUTH_MESSAGES.UNAUTHORIZED).not.toMatch(/\.$/u)
    })
  })

  describe('INPUT_MESSAGES', () => {
    it('should have all required input validation messages', () => {
      expect(INPUT_MESSAGES.NO_ORG_SLUG).toBeTruthy()
      expect(INPUT_MESSAGES.NO_REPO_NAME).toBeTruthy()
      expect(INPUT_MESSAGES.NO_PACKAGE).toBeTruthy()
      expect(INPUT_MESSAGES.INVALID_TIME_FILTER).toBeTruthy()
      expect(INPUT_MESSAGES.INVALID_FORMAT).toBeTruthy()
    })

    it('should have message builder functions', () => {
      expect(typeof INPUT_MESSAGES.MISSING_PARAM).toBe('function')
      expect(typeof INPUT_MESSAGES.INVALID_PARAM).toBe('function')
    })

    it('should build MISSING_PARAM message correctly', () => {
      const msg = INPUT_MESSAGES.MISSING_PARAM('apiToken')
      expect(msg).toContain('apiToken')
      expect(msg).toContain('Missing')
    })

    it('should build INVALID_PARAM message correctly', () => {
      const msg1 = INPUT_MESSAGES.INVALID_PARAM('timeout')
      expect(msg1).toContain('timeout')
      expect(msg1).toContain('Invalid')

      const msg2 = INPUT_MESSAGES.INVALID_PARAM('timeout', 'must be positive')
      expect(msg2).toContain('timeout')
      expect(msg2).toContain('must be positive')
    })
  })

  describe('SDK_MESSAGES', () => {
    it('should have all SDK operation messages', () => {
      expect(SDK_MESSAGES.SETUP_FAILED).toBeTruthy()
      expect(SDK_MESSAGES.MISSING_CONFIG).toBeTruthy()
      expect(SDK_MESSAGES.API_ERROR).toBeTruthy()
      expect(SDK_MESSAGES.NETWORK_ERROR).toBeTruthy()
      expect(SDK_MESSAGES.CONNECTION_TIMEOUT).toBeTruthy()
    })

    it('should have descriptive error messages', () => {
      expect(SDK_MESSAGES.API_ERROR).toContain('API')
      expect(SDK_MESSAGES.NETWORK_ERROR).toContain('Network')
      expect(SDK_MESSAGES.CONNECTION_TIMEOUT).toContain('timeout')
    })
  })

  describe('RESOURCE_MESSAGES', () => {
    it('should have resource message builders', () => {
      expect(typeof RESOURCE_MESSAGES.NOT_FOUND).toBe('function')
      expect(typeof RESOURCE_MESSAGES.ALREADY_EXISTS).toBe('function')
      expect(typeof RESOURCE_MESSAGES.CREATED).toBe('function')
      expect(typeof RESOURCE_MESSAGES.UPDATED).toBe('function')
      expect(typeof RESOURCE_MESSAGES.DELETED).toBe('function')
    })

    it('should build NOT_FOUND message correctly', () => {
      const msg = RESOURCE_MESSAGES.NOT_FOUND('Repository')
      expect(msg).toContain('Repository')
      expect(msg).toContain('not found')
    })

    it('should build CREATED message correctly', () => {
      const msg = RESOURCE_MESSAGES.CREATED('Scan')
      expect(msg).toContain('Scan')
      expect(msg).toContain('created')
      expect(msg).toContain('successfully')
    })

    it('should have consistent message patterns', () => {
      const created = RESOURCE_MESSAGES.CREATED('Test')
      const updated = RESOURCE_MESSAGES.UPDATED('Test')
      const deleted = RESOURCE_MESSAGES.DELETED('Test')

      // All success messages should contain 'successfully'
      expect(created).toContain('successfully')
      expect(updated).toContain('successfully')
      expect(deleted).toContain('successfully')
    })

    it('should have failure message builders', () => {
      expect(typeof RESOURCE_MESSAGES.FAILED_TO_CREATE).toBe('function')
      expect(typeof RESOURCE_MESSAGES.FAILED_TO_UPDATE).toBe('function')
      expect(typeof RESOURCE_MESSAGES.FAILED_TO_DELETE).toBe('function')
      expect(typeof RESOURCE_MESSAGES.FAILED_TO_FETCH).toBe('function')
    })
  })

  describe('REPO_MESSAGES', () => {
    it('should have repository-specific messages', () => {
      expect(REPO_MESSAGES.NO_REPOS_FOUND).toBeTruthy()
      expect(REPO_MESSAGES.REPO_NOT_FOUND).toBeTruthy()
    })

    it('should have repository message builders', () => {
      expect(typeof REPO_MESSAGES.REPO_CREATED).toBe('function')
      expect(typeof REPO_MESSAGES.REPO_UPDATED).toBe('function')
      expect(typeof REPO_MESSAGES.REPO_DELETED).toBe('function')
    })

    it('should format repository names in messages', () => {
      const msg = REPO_MESSAGES.REPO_CREATED('my-repo')
      expect(msg).toContain('my-repo')
      expect(msg).toContain('`') // Should use backticks for formatting
    })
  })

  describe('SCAN_MESSAGES', () => {
    it('should have scan-specific messages', () => {
      expect(SCAN_MESSAGES.NO_SCANS_FOUND).toBeTruthy()
      expect(SCAN_MESSAGES.SCAN_NOT_FOUND).toBeTruthy()
      expect(SCAN_MESSAGES.SCAN_IN_PROGRESS).toBeTruthy()
      expect(SCAN_MESSAGES.SCAN_COMPLETE).toBeTruthy()
    })

    it('should have scan message builders', () => {
      expect(typeof SCAN_MESSAGES.SCAN_CREATED).toBe('function')
      expect(typeof SCAN_MESSAGES.SCAN_DELETED).toBe('function')
    })

    it('should format scan IDs in messages', () => {
      const msg = SCAN_MESSAGES.SCAN_CREATED('scan-123')
      expect(msg).toContain('scan-123')
      expect(msg).toContain('`')
    })
  })

  describe('PACKAGE_MESSAGES', () => {
    it('should have package-specific messages', () => {
      expect(PACKAGE_MESSAGES.NO_PACKAGE_FOUND).toBeTruthy()
      expect(PACKAGE_MESSAGES.NO_GHSA_FOUND).toBeTruthy()
      expect(PACKAGE_MESSAGES.NO_CVE_FOUND).toBeTruthy()
      expect(PACKAGE_MESSAGES.INVALID_PURL).toBeTruthy()
      expect(PACKAGE_MESSAGES.NO_CAPABILITIES).toBeTruthy()
    })

    it('should have package message builders', () => {
      expect(typeof PACKAGE_MESSAGES.INVALID_GHSA).toBe('function')
      expect(typeof PACKAGE_MESSAGES.INVALID_CVE).toBe('function')
      expect(typeof PACKAGE_MESSAGES.MISSING_RESPONSE).toBe('function')
    })

    it('should build INVALID_GHSA message correctly', () => {
      const msg = PACKAGE_MESSAGES.INVALID_GHSA('GHSA-1234-5678-9abc')
      expect(msg).toContain('GHSA-1234-5678-9abc')
      expect(msg).toContain('Invalid')
      expect(msg).toContain('GHSA')
    })

    it('should build INVALID_CVE message correctly', () => {
      const msg = PACKAGE_MESSAGES.INVALID_CVE('CVE-2023-1234')
      expect(msg).toContain('CVE-2023-1234')
      expect(msg).toContain('Invalid')
      expect(msg).toContain('CVE')
    })
  })

  describe('ORG_MESSAGES', () => {
    it('should have organization-specific messages', () => {
      expect(ORG_MESSAGES.NO_ORGS_FOUND).toBeTruthy()
      expect(ORG_MESSAGES.ORG_NOT_FOUND).toBeTruthy()
    })

    it('should have DATA_NOT_AVAILABLE builder', () => {
      expect(typeof ORG_MESSAGES.DATA_NOT_AVAILABLE).toBe('function')
    })

    it('should build DATA_NOT_AVAILABLE for org scope', () => {
      const msg = ORG_MESSAGES.DATA_NOT_AVAILABLE('org')
      expect(msg).toContain('organization')
      expect(msg).toContain('not yet available')
    })

    it('should build DATA_NOT_AVAILABLE for repo scope', () => {
      const msg = ORG_MESSAGES.DATA_NOT_AVAILABLE('repo')
      expect(msg).toContain('repository')
      expect(msg).toContain('not yet available')
    })
  })

  describe('FILE_MESSAGES', () => {
    it('should have file operation message builders', () => {
      expect(typeof FILE_MESSAGES.FILE_NOT_FOUND).toBe('function')
      expect(typeof FILE_MESSAGES.FILE_READ_ERROR).toBe('function')
      expect(typeof FILE_MESSAGES.FILE_WRITE_ERROR).toBe('function')
      expect(typeof FILE_MESSAGES.DIRECTORY_NOT_FOUND).toBe('function')
    })

    it('should build FILE_NOT_FOUND message correctly', () => {
      const msg = FILE_MESSAGES.FILE_NOT_FOUND('/path/to/file.json')
      expect(msg).toContain('/path/to/file.json')
      expect(msg).toContain('not found')
    })

    it('should build FILE_WRITE_ERROR message correctly', () => {
      const msg = FILE_MESSAGES.FILE_WRITE_ERROR('output.txt')
      expect(msg).toContain('output.txt')
      expect(msg).toContain('Failed')
    })

    it('should have static messages', () => {
      expect(FILE_MESSAGES.FILE_WRITE_FAILURE).toBeTruthy()
      expect(FILE_MESSAGES.NO_SOCKET_DIR).toBeTruthy()
    })
  })

  describe('CONFIG_MESSAGES', () => {
    it('should have configuration messages', () => {
      expect(CONFIG_MESSAGES.UNSUPPORTED_OPERATION).toBeTruthy()
      expect(CONFIG_MESSAGES.INVALID_CONFIG).toBeTruthy()
      expect(CONFIG_MESSAGES.CONFIG_UPDATED).toBeTruthy()
      expect(CONFIG_MESSAGES.SOURCE_NOT_FOUND).toBeTruthy()
    })

    it('should have MISSING_ENV_VAR builder', () => {
      expect(typeof CONFIG_MESSAGES.MISSING_ENV_VAR).toBe('function')
    })

    it('should build MISSING_ENV_VAR message correctly', () => {
      const msg = CONFIG_MESSAGES.MISSING_ENV_VAR('API_KEY, API_URL')
      expect(msg).toContain('API_KEY, API_URL')
      expect(msg).toContain('Missing')
    })
  })

  describe('GENERAL_MESSAGES', () => {
    it('should have general operation messages', () => {
      expect(GENERAL_MESSAGES.SUCCESS).toBeTruthy()
    })

    it('should have operation message builders', () => {
      expect(typeof GENERAL_MESSAGES.OPERATION_FAILED).toBe('function')
      expect(typeof GENERAL_MESSAGES.OPERATION_SUCCESS).toBe('function')
      expect(typeof GENERAL_MESSAGES.LEGACY_FLAGS_DEPRECATED).toBe('function')
    })

    it('should build OPERATION_FAILED message correctly', () => {
      const msg = GENERAL_MESSAGES.OPERATION_FAILED('parse manifest')
      expect(msg).toContain('parse manifest')
      expect(msg).toContain('Failed')
    })

    it('should build OPERATION_SUCCESS message correctly', () => {
      const msg = GENERAL_MESSAGES.OPERATION_SUCCESS('updated configuration')
      expect(msg).toContain('updated configuration')
      expect(msg).toContain('Successfully')
    })

    it('should build LEGACY_FLAGS_DEPRECATED message correctly', () => {
      const msg = GENERAL_MESSAGES.LEGACY_FLAGS_DEPRECATED(
        'https://docs.socket.dev/migration',
      )
      expect(msg).toContain('https://docs.socket.dev/migration')
      expect(msg).toContain('no longer supported')
    })
  })

  describe('VALIDATION_MESSAGES', () => {
    it('should have validation message builders', () => {
      expect(typeof VALIDATION_MESSAGES.ENUM_INVALID).toBe('function')
      expect(typeof VALIDATION_MESSAGES.STRING_REQUIRED).toBe('function')
      expect(typeof VALIDATION_MESSAGES.STRING_EMPTY).toBe('function')
      expect(typeof VALIDATION_MESSAGES.NUMBER_INVALID).toBe('function')
      expect(typeof VALIDATION_MESSAGES.NUMBER_OUT_OF_RANGE).toBe('function')
    })

    it('should build ENUM_INVALID message correctly', () => {
      const msg = VALIDATION_MESSAGES.ENUM_INVALID('format', ['json', 'text'])
      expect(msg).toContain('format')
      expect(msg).toContain('json')
      expect(msg).toContain('text')
      expect(msg).toContain('must be one of')
    })

    it('should build STRING_REQUIRED message correctly', () => {
      const msg = VALIDATION_MESSAGES.STRING_REQUIRED('username')
      expect(msg).toContain('username')
      expect(msg).toContain('required')
    })

    it('should build NUMBER_OUT_OF_RANGE message correctly', () => {
      const msg = VALIDATION_MESSAGES.NUMBER_OUT_OF_RANGE('timeout', 100, 5000)
      expect(msg).toContain('timeout')
      expect(msg).toContain('100')
      expect(msg).toContain('5000')
      expect(msg).toContain('between')
    })
  })

  describe('message consistency', () => {
    it('should use consistent capitalization for similar messages', () => {
      // Check that similar messages follow same pattern
      const authMessages = Object.values(AUTH_MESSAGES)
      const allCapitalized = authMessages.every(
        msg => msg.charAt(0) === msg.charAt(0).toUpperCase(),
      )
      expect(allCapitalized).toBe(true)
    })

    it('should not have trailing periods in error messages', () => {
      const errorMessages = [
        AUTH_MESSAGES.NO_TOKEN,
        AUTH_MESSAGES.INVALID_TOKEN,
        SDK_MESSAGES.API_ERROR,
        SDK_MESSAGES.NETWORK_ERROR,
        INPUT_MESSAGES.NO_ORG_SLUG,
        INPUT_MESSAGES.NO_PACKAGE,
      ]

      for (const msg of errorMessages) {
        expect(msg).not.toMatch(/\.$/u)
      }
    })

    it('should use consistent terminology', () => {
      // Check for consistent use of "API" vs "api"
      const sdkMessages = Object.values(SDK_MESSAGES).join(' ')
      expect(sdkMessages).toContain('API')
      expect(sdkMessages).not.toContain(' api ')
    })

    it('should have all message categories defined', () => {
      expect(AUTH_MESSAGES).toBeDefined()
      expect(INPUT_MESSAGES).toBeDefined()
      expect(SDK_MESSAGES).toBeDefined()
      expect(RESOURCE_MESSAGES).toBeDefined()
      expect(REPO_MESSAGES).toBeDefined()
      expect(SCAN_MESSAGES).toBeDefined()
      expect(PACKAGE_MESSAGES).toBeDefined()
      expect(ORG_MESSAGES).toBeDefined()
      expect(FILE_MESSAGES).toBeDefined()
      expect(CONFIG_MESSAGES).toBeDefined()
      expect(GENERAL_MESSAGES).toBeDefined()
      expect(VALIDATION_MESSAGES).toBeDefined()
    })
  })
})
