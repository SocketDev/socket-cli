/**
 * Unit tests for common validation utilities.
 *
 * Purpose:
 * Tests the common validation patterns and workflow.
 *
 * Test Coverage:
 * - validations object (requireOrg, requireAuth, notBoth, isOneOf, isPositive, notEmpty, isUrl)
 * - runStandardValidations function
 * - validateParams (pagination, sorting, outputFlags)
 *
 * Related Files:
 * - src/utils/validation/common.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock check-input.
const mockCheckCommandInput = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/utils/validation/check-input.mts', () => ({
  checkCommandInput: mockCheckCommandInput,
}))

// Mock SDK.
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn(() => true))
vi.mock('../../../../src/utils/socket/sdk.mjs', () => ({
  hasDefaultApiToken: mockHasDefaultApiToken,
}))

import {
  runStandardValidations,
  validateParams,
  validations,
} from '../../../../src/utils/validation/common.mts'

describe('common validation utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default to returning true for valid.
    mockCheckCommandInput.mockReturnValue(true)
    mockHasDefaultApiToken.mockReturnValue(true)
  })

  describe('validations.requireOrg', () => {
    it('returns true when org is provided', () => {
      validations.requireOrg('my-org', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
          message: expect.stringContaining('Organization slug'),
        }),
      )
    })

    it('returns false when org is undefined', () => {
      mockCheckCommandInput.mockReturnValue(false)

      validations.requireOrg(undefined, 'json')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'json',
        expect.objectContaining({
          test: false,
        }),
      )
    })
  })

  describe('validations.requireAuth', () => {
    it('returns true when auth token exists', () => {
      mockHasDefaultApiToken.mockReturnValue(true)

      validations.requireAuth('text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
          message: expect.stringContaining('authentication'),
        }),
      )
    })

    it('returns false when no auth token', () => {
      mockHasDefaultApiToken.mockReturnValue(false)
      mockCheckCommandInput.mockReturnValue(false)

      validations.requireAuth('text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: false,
        }),
      )
    })
  })

  describe('validations.notBoth', () => {
    it('returns true when neither flag is set', () => {
      validations.notBoth(false, false, 'json', 'markdown', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
        }),
      )
    })

    it('returns true when only first flag is set', () => {
      validations.notBoth(true, false, 'json', 'markdown', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
        }),
      )
    })

    it('returns false when both flags are set', () => {
      mockCheckCommandInput.mockReturnValue(false)

      validations.notBoth(true, true, 'json', 'markdown', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: false,
          message: expect.stringContaining('Cannot use both'),
        }),
      )
    })
  })

  describe('validations.isOneOf', () => {
    it('returns true when value is in options', () => {
      validations.isOneOf('asc', ['asc', 'desc'], 'direction', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
        }),
      )
    })

    it('returns false when value not in options', () => {
      mockCheckCommandInput.mockReturnValue(false)

      validations.isOneOf('invalid', ['asc', 'desc'], 'direction', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: false,
          message: expect.stringContaining('must be one of'),
        }),
      )
    })
  })

  describe('validations.isPositive', () => {
    it('returns true for positive number', () => {
      validations.isPositive(10, 'limit', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
        }),
      )
    })

    it('returns false for zero', () => {
      mockCheckCommandInput.mockReturnValue(false)

      validations.isPositive(0, 'limit', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: false,
          message: expect.stringContaining('positive number'),
        }),
      )
    })

    it('returns false for negative number', () => {
      mockCheckCommandInput.mockReturnValue(false)

      validations.isPositive(-5, 'limit', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: false,
        }),
      )
    })
  })

  describe('validations.notEmpty', () => {
    it('returns true for non-empty string', () => {
      validations.notEmpty('value', 'name', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
        }),
      )
    })

    it('returns false for empty string', () => {
      mockCheckCommandInput.mockReturnValue(false)

      validations.notEmpty('', 'name', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: false,
          message: expect.stringContaining('cannot be empty'),
        }),
      )
    })
  })

  describe('validations.isUrl', () => {
    it('returns true for https URL', () => {
      validations.isUrl('https://example.com', 'url', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
        }),
      )
    })

    it('returns true for http URL', () => {
      validations.isUrl('http://example.com/path', 'url', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
        }),
      )
    })

    it('returns false for invalid URL', () => {
      mockCheckCommandInput.mockReturnValue(false)

      validations.isUrl('not-a-url', 'url', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: false,
          message: expect.stringContaining('valid URL'),
        }),
      )
    })
  })

  describe('runStandardValidations', () => {
    it('returns true when all validations pass', () => {
      const result = runStandardValidations({
        outputKind: 'text',
        requireAuth: true,
        requireOrg: 'my-org',
      })

      expect(result).toBe(true)
    })

    it('returns false when custom validation fails', () => {
      const result = runStandardValidations({
        outputKind: 'text',
        validations: [() => false],
      })

      expect(result).toBe(false)
    })

    it('returns false when requireOrg fails', () => {
      // Mock checkCommandInput to return false when test condition is false.
      mockCheckCommandInput.mockImplementation((_, opts) => opts.test)

      const result = runStandardValidations({
        outputKind: 'text',
        requireOrg: '', // Empty string fails requireOrg.
      })

      expect(result).toBe(false)
    })

    it('returns false for dry run', () => {
      const result = runStandardValidations({
        outputKind: 'text',
        dryRun: true,
      })

      expect(result).toBe(false)
    })

    it('returns false when requireAuth fails', () => {
      mockHasDefaultApiToken.mockReturnValue(false)
      mockCheckCommandInput.mockReturnValue(false)

      const result = runStandardValidations({
        outputKind: 'text',
        requireAuth: true,
      })

      expect(result).toBe(false)
    })

    it('runs custom validations before standard ones', () => {
      const customValidation = vi.fn(() => false)

      runStandardValidations({
        outputKind: 'text',
        validations: [customValidation],
        requireAuth: true,
      })

      expect(customValidation).toHaveBeenCalled()
      // requireAuth should not be checked if custom validation fails.
      expect(mockCheckCommandInput).not.toHaveBeenCalled()
    })
  })

  describe('validateParams.pagination', () => {
    it('validates both page and perPage', () => {
      validateParams.pagination(1, 10, 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledTimes(2)
    })

    it('returns false when page is invalid', () => {
      mockCheckCommandInput.mockReturnValueOnce(false)

      const result = validateParams.pagination(0, 10, 'text')

      expect(result).toBe(false)
    })
  })

  describe('validateParams.sorting', () => {
    it('validates direction is asc or desc', () => {
      validateParams.sorting('name', 'asc', 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
        }),
      )
    })
  })

  describe('validateParams.outputFlags', () => {
    it('validates json and markdown not both set', () => {
      validateParams.outputFlags(true, false, 'text')

      expect(mockCheckCommandInput).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          test: true,
        }),
      )
    })
  })
})
