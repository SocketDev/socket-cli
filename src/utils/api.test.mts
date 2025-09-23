import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies first.
vi.mock('./config.mts', () => ({
  getConfigValueOrUndef: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

vi.mock('@socketsecurity/registry/lib/spinner', () => ({
  Spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  })),
}))

// Mock constants module.
let mockEnv = {
  SOCKET_CLI_API_BASE_URL: undefined as string | undefined,
}

vi.mock('../constants.mts', async () => {
  const actual =
    await vi.importActual<typeof import('../constants.mts')>('../constants.mts')
  return {
    ...actual,
    default: {
      ...actual.default,
      get ENV() {
        return mockEnv
      },
      API_V0_URL: 'https://api.socket.dev/v0/',
    },
  }
})

import {
  getDefaultApiBaseUrl,
  getErrorMessageForHttpStatusCode,
  handleApiCall,
  handleApiCallNoSpinner,
} from './api.mts'

describe('api utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset environment variables.
    mockEnv.SOCKET_CLI_API_BASE_URL = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getDefaultApiBaseUrl', () => {
    it('returns environment variable when set', async () => {
      mockEnv.SOCKET_CLI_API_BASE_URL = 'https://custom.api.url'
      const result = getDefaultApiBaseUrl()
      expect(result).toBe('https://custom.api.url')
    })

    it('falls back to config value when env not set', async () => {
      const { getConfigValueOrUndef } = await import('./config.mts')
      vi.mocked(getConfigValueOrUndef).mockReturnValue('https://config.api.url')

      const result = getDefaultApiBaseUrl()
      expect(result).toBe('https://config.api.url')
    })

    it('returns default API_V0_URL when neither env nor config set', async () => {
      const { getConfigValueOrUndef } = await import('./config.mts')
      vi.mocked(getConfigValueOrUndef).mockReturnValue(undefined)

      const result = getDefaultApiBaseUrl()
      expect(result).toBe('https://api.socket.dev/v0/')
    })
  })

  describe('getErrorMessageForHttpStatusCode', () => {
    it('returns message for 400 Bad Request', async () => {
      const result = await getErrorMessageForHttpStatusCode(400)
      expect(result).toContain('incorrect')
    })

    it('returns message for 401 Unauthorized', async () => {
      const result = await getErrorMessageForHttpStatusCode(401)
      expect(result).toContain('permissions')
    })

    it('returns message for 403 Forbidden', async () => {
      const result = await getErrorMessageForHttpStatusCode(403)
      expect(result).toContain('permissions')
    })

    it('returns message for 404 Not Found', async () => {
      const result = await getErrorMessageForHttpStatusCode(404)
      expect(result).toContain('not found')
    })

    it('returns message for 500 Internal Server Error', async () => {
      const result = await getErrorMessageForHttpStatusCode(500)
      expect(result).toContain('server side problem')
    })

    it('returns generic message for unknown status code', async () => {
      const result = await getErrorMessageForHttpStatusCode(418)
      expect(result).toContain('status code 418')
    })
  })

  describe('handleApiCall', () => {
    it('returns success result for successful API call', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { result: 'test' },
      } as any)

      const result = await handleApiCall(mockApiPromise)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ result: 'test' })
      }
    })

    it('returns error result for failed API call', async () => {
      const mockApiPromise = Promise.resolve({
        success: false,
        error: { message: 'API error', statusCode: 400 },
      } as any)

      const result = await handleApiCall(mockApiPromise)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Socket API error')
      }
    })

    it('handles API call exceptions', async () => {
      const mockApiPromise = Promise.reject(new Error('Network error'))

      const result = await handleApiCall(mockApiPromise)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Socket API error')
      }
    })

    it('uses spinner when provided', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { result: 'test' },
      } as any)

      const mockSpinner = {
        start: vi.fn(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
      }

      await handleApiCall(mockApiPromise, { spinner: mockSpinner as any })
      expect(mockSpinner.start).toHaveBeenCalled()
      expect(mockSpinner.stop).toHaveBeenCalled()
    })
  })

  describe('handleApiCallNoSpinner', () => {
    it('does not use spinner even if provided', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { result: 'test' },
      } as any)

      const mockSpinner = {
        start: vi.fn(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
      }

      await handleApiCallNoSpinner(mockApiPromise, {
        spinner: mockSpinner as any,
      })
      expect(mockSpinner.start).not.toHaveBeenCalled()
    })

    it('returns success result for successful API call', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { result: 'test' },
      } as any)

      const result = await handleApiCallNoSpinner(mockApiPromise)
      expect(result.ok).toBe(true)
    })
  })
})
