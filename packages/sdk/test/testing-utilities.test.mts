/**
 * @fileoverview Tests for SDK testing utilities.
 * Validates mock factories, response builders, and test helpers.
 */

import { describe, expect, it } from 'vitest'

import {
  fixtures,
  isErrorResult,
  isSuccessResult,
  issueFixtures,
  mockApiErrorBody,
  mockErrorResponse,
  mockSdkError,
  mockSdkResult,
  mockSuccessResponse,
  organizationFixtures,
  packageFixtures,
  repositoryFixtures,
  scanFixtures,
} from '../src/testing'

describe('Testing Utilities', () => {
  describe('mockSuccessResponse', () => {
    it('should create a successful response with default status', () => {
      const data = { id: '123', name: 'test' }
      const response = mockSuccessResponse(data)

      expect(response.success).toBe(true)
      expect(response.status).toBe(200)
      expect(response.data).toEqual(data)
      expect(response.error).toBeUndefined()
      expect(response.cause).toBeUndefined()
    })

    it('should create a successful response with custom status', () => {
      const data = { id: '456' }
      const response = mockSuccessResponse(data, 201)

      expect(response.success).toBe(true)
      expect(response.status).toBe(201)
      expect(response.data).toEqual(data)
    })

    it('should handle array data', () => {
      const data = [{ id: '1' }, { id: '2' }]
      const response = mockSuccessResponse(data)

      expect(response.success).toBe(true)
      expect(response.data).toEqual(data)
      expect(Array.isArray(response.data)).toBe(true)
    })

    it('should handle null data', () => {
      const response = mockSuccessResponse(null)

      expect(response.success).toBe(true)
      expect(response.data).toBeNull()
    })
  })

  describe('mockErrorResponse', () => {
    it('should create an error response with default status', () => {
      const error = 'Something went wrong'
      const response = mockErrorResponse(error)

      expect(response.success).toBe(false)
      expect(response.status).toBe(500)
      expect(response.error).toBe(error)
      expect(response.data).toBeUndefined()
    })

    it('should create an error response with custom status', () => {
      const error = 'Not found'
      const response = mockErrorResponse(error, 404)

      expect(response.success).toBe(false)
      expect(response.status).toBe(404)
      expect(response.error).toBe(error)
    })

    it('should include cause when provided', () => {
      const error = 'Request failed'
      const cause = 'Network timeout'
      const response = mockErrorResponse(error, 500, cause)

      expect(response.success).toBe(false)
      expect(response.error).toBe(error)
      expect(response.cause).toBe(cause)
    })

    it('should handle empty error message', () => {
      const response = mockErrorResponse('')

      expect(response.success).toBe(false)
      expect(response.error).toBe('')
    })
  })

  describe('mockApiErrorBody', () => {
    it('should create error body with message only', () => {
      const message = 'Repository not found'
      const body = mockApiErrorBody(message)

      expect(body).toEqual({
        error: {
          message,
        },
      })
    })

    it('should create error body with details', () => {
      const message = 'Validation failed'
      const details = { field: 'name', reason: 'required' }
      const body = mockApiErrorBody(message, details)

      expect(body).toEqual({
        error: {
          details,
          message,
        },
      })
    })

    it('should handle empty details object', () => {
      const message = 'Error occurred'
      const body = mockApiErrorBody(message, {})

      expect(body).toEqual({
        error: {
          details: {},
          message,
        },
      })
    })
  })

  describe('mockSdkResult', () => {
    it('should create successful result', () => {
      const data = { id: '123', name: 'repo' }
      const result = mockSdkResult<'getOrgRepo'>(true, data as never)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(data)
        expect(result.status).toBe(200)
        expect(result.error).toBeUndefined()
      }
    })

    it('should create successful result with custom status', () => {
      const data = { created: true }
      const result = mockSdkResult<'createReport'>(true, data as never, 201)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.status).toBe(201)
      }
    })

    it('should create error result', () => {
      const error = 'Repository not found'
      const result = mockSdkResult<'getOrgRepo'>(false, error, 404)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe(error)
        expect(result.status).toBe(404)
        expect(result.data).toBeUndefined()
      }
    })

    it('should create error result with cause', () => {
      const error = 'Request failed'
      const cause = 'Connection timeout'
      const result = mockSdkResult<'getOrgRepo'>(false, error, 500, cause)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe(error)
        expect(result.cause).toBe(cause)
      }
    })

    it('should create error result with default status', () => {
      const error = 'Operation failed'
      const result = mockSdkResult<'getOrgRepo'>(false, error)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe(error)
        expect(result.status).toBe(500)
        expect(result.data).toBeUndefined()
      }
    })
  })

  describe('mockSdkError', () => {
    it('should create NOT_FOUND error', () => {
      const error = mockSdkError('NOT_FOUND')

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Resource not found')
      expect(error.status).toBe(404)
    })

    it('should create UNAUTHORIZED error', () => {
      const error = mockSdkError('UNAUTHORIZED')

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Unauthorized')
      expect(error.status).toBe(401)
    })

    it('should create FORBIDDEN error', () => {
      const error = mockSdkError('FORBIDDEN')

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Access forbidden')
      expect(error.status).toBe(403)
    })

    it('should create SERVER_ERROR error', () => {
      const error = mockSdkError('SERVER_ERROR')

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Internal server error')
      expect(error.status).toBe(500)
    })

    it('should create TIMEOUT error', () => {
      const error = mockSdkError('TIMEOUT')

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Request timeout')
      expect(error.status).toBe(408)
    })

    it('should use custom message', () => {
      const customMessage = 'Custom error message'
      const error = mockSdkError('NOT_FOUND', { message: customMessage })

      expect(error.message).toBe(customMessage)
      expect(error.status).toBe(404)
    })

    it('should use custom status', () => {
      const error = mockSdkError('SERVER_ERROR', { status: 503 })

      expect(error.status).toBe(503)
    })

    it('should include cause', () => {
      const cause = 'Network failure'
      const error = mockSdkError('TIMEOUT', { cause })

      expect(error.cause).toBe(cause)
    })
  })

  describe('Type Guards', () => {
    describe('isSuccessResult', () => {
      it('should return true for successful result', () => {
        const result = mockSuccessResponse({ id: '123' })
        expect(isSuccessResult(result)).toBe(true)
      })

      it('should return false for error result', () => {
        const result = mockErrorResponse('Error')
        expect(isSuccessResult(result)).toBe(false)
      })

      it('should narrow type correctly', () => {
        const result = mockSuccessResponse({ id: '123', name: 'test' })
        if (isSuccessResult(result)) {
          // TypeScript should allow accessing data
          expect(result.data.id).toBe('123')
          expect(result.data.name).toBe('test')
          // error is undefined on success result
          expect(result.error).toBeUndefined()
        }
      })
    })

    describe('isErrorResult', () => {
      it('should return false for successful result', () => {
        const result = mockSuccessResponse({ id: '123' })
        expect(isErrorResult(result)).toBe(false)
      })

      it('should return true for error result', () => {
        const result = mockErrorResponse('Error')
        expect(isErrorResult(result)).toBe(true)
      })

      it('should narrow type correctly', () => {
        const result = mockErrorResponse('Not found', 404, 'Resource missing')
        if (isErrorResult(result)) {
          // TypeScript should allow accessing error fields
          expect(result.error).toBe('Not found')
          expect(result.status).toBe(404)
          expect(result.cause).toBe('Resource missing')
          // data is undefined on error result
          expect(result.data).toBeUndefined()
        }
      })
    })
  })

  describe('Fixtures', () => {
    describe('organizationFixtures', () => {
      it('should have basic organization', () => {
        expect(organizationFixtures.basic).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          plan: expect.any(String),
        })
      })

      it('should have full organization', () => {
        expect(organizationFixtures.full).toMatchObject({
          created_at: expect.any(String),
          id: expect.any(String),
          name: expect.any(String),
          plan: expect.any(String),
          updated_at: expect.any(String),
        })
      })
    })

    describe('repositoryFixtures', () => {
      it('should have basic repository', () => {
        expect(repositoryFixtures.basic).toMatchObject({
          archived: false,
          default_branch: expect.any(String),
          id: expect.any(String),
          name: expect.any(String),
        })
      })

      it('should have archived repository', () => {
        expect(repositoryFixtures.archived).toMatchObject({
          archived: true,
          default_branch: expect.any(String),
          id: expect.any(String),
          name: expect.any(String),
        })
      })

      it('should have full repository', () => {
        expect(repositoryFixtures.full).toMatchObject({
          archived: expect.any(Boolean),
          created_at: expect.any(String),
          default_branch: expect.any(String),
          homepage: expect.any(String),
          id: expect.any(String),
          name: expect.any(String),
          updated_at: expect.any(String),
          visibility: expect.any(String),
        })
      })
    })

    describe('scanFixtures', () => {
      it('should have pending scan', () => {
        expect(scanFixtures.pending).toMatchObject({
          created_at: expect.any(String),
          id: expect.any(String),
          status: 'pending',
        })
      })

      it('should have completed scan', () => {
        expect(scanFixtures.completed).toMatchObject({
          completed_at: expect.any(String),
          created_at: expect.any(String),
          id: expect.any(String),
          issues_found: 0,
          status: 'completed',
        })
      })

      it('should have scan with issues', () => {
        expect(scanFixtures.withIssues).toMatchObject({
          issues_found: expect.any(Number),
          status: 'completed',
        })
        expect(scanFixtures.withIssues.issues_found).toBeGreaterThan(0)
      })

      it('should have failed scan', () => {
        expect(scanFixtures.failed).toMatchObject({
          created_at: expect.any(String),
          error: expect.any(String),
          id: expect.any(String),
          status: 'failed',
        })
      })
    })

    describe('packageFixtures', () => {
      it('should have safe package', () => {
        expect(packageFixtures.safe).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          score: expect.any(Number),
          version: expect.any(String),
        })
        expect(packageFixtures.safe.score).toBeGreaterThanOrEqual(90)
      })

      it('should have vulnerable package', () => {
        expect(packageFixtures.vulnerable).toMatchObject({
          id: expect.any(String),
          issues: expect.any(Array),
          name: expect.any(String),
          score: expect.any(Number),
          version: expect.any(String),
        })
        expect(packageFixtures.vulnerable.score).toBeLessThan(50)
      })

      it('should have malware package', () => {
        expect(packageFixtures.malware).toMatchObject({
          id: expect.any(String),
          issues: expect.arrayContaining(['malware']),
          name: expect.any(String),
          score: 0,
          version: expect.any(String),
        })
      })
    })

    describe('issueFixtures', () => {
      it('should have vulnerability issue', () => {
        expect(issueFixtures.vulnerability).toMatchObject({
          description: expect.any(String),
          key: expect.any(String),
          severity: expect.any(String),
          type: 'vulnerability',
        })
      })

      it('should have malware issue', () => {
        expect(issueFixtures.malware).toMatchObject({
          description: expect.any(String),
          severity: 'critical',
          type: 'malware',
        })
      })

      it('should have license issue', () => {
        expect(issueFixtures.license).toMatchObject({
          description: expect.any(String),
          severity: expect.any(String),
          type: 'license',
        })
      })
    })

    describe('fixtures object', () => {
      it('should export all fixture categories', () => {
        expect(fixtures).toHaveProperty('organizations')
        expect(fixtures).toHaveProperty('repositories')
        expect(fixtures).toHaveProperty('scans')
        expect(fixtures).toHaveProperty('packages')
        expect(fixtures).toHaveProperty('issues')
      })

      it('should have consistent structure', () => {
        expect(fixtures.organizations).toBe(organizationFixtures)
        expect(fixtures.repositories).toBe(repositoryFixtures)
        expect(fixtures.scans).toBe(scanFixtures)
        expect(fixtures.packages).toBe(packageFixtures)
        expect(fixtures.issues).toBe(issueFixtures)
      })
    })
  })

  describe('Integration Examples', () => {
    it('should work with vi.fn() for mocking SDK methods', async () => {
      const { vi } = await import('vitest')
      const mockMethod = vi
        .fn()
        .mockResolvedValue(mockSuccessResponse(repositoryFixtures.basic, 200))

      const result = await mockMethod('org', 'repo')

      expect(mockMethod).toHaveBeenCalledWith('org', 'repo')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('test-repo')
      }
    })

    it('should work with error scenarios', async () => {
      const { vi } = await import('vitest')
      const mockMethod = vi
        .fn()
        .mockResolvedValue(mockErrorResponse('Not found', 404))

      const result = await mockMethod('org', 'missing-repo')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Not found')
        expect(result.status).toBe(404)
      }
    })

    it('should work with rejected promises', async () => {
      const { vi } = await import('vitest')
      const mockMethod = vi
        .fn()
        .mockRejectedValue(mockSdkError('TIMEOUT', { message: 'Timed out' }))

      await expect(mockMethod()).rejects.toMatchObject({
        message: 'Timed out',
        status: 408,
      })
    })
  })
})
