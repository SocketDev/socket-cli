/**
 * Mock utilities for Socket authentication and login flow.
 * Provides test doubles for authentication-related functionality.
 */

import { expect, vi } from 'vitest'

export const MOCK_API_TOKEN = 'mock_socket_api_token_1234567890'
export const MOCK_ORG_NAME = 'test-org'
export const MOCK_ORG_ID = 'org_123456'

/**
 * Mock authentication flow response.
 */
export interface MockAuthResponse {
  success: boolean
  token?: string
  error?: string
  org?: {
    id: string
    name: string
  }
}

/**
 * Mock the interactive login flow.
 * Simulates opening browser, polling for auth completion.
 */
export function mockInteractiveLogin(options?: { shouldSucceed?: boolean }) {
  const { shouldSucceed = true } = options || {}

  return vi.fn().mockImplementation(async () => {
    if (shouldSucceed) {
      return {
        success: true,
        token: MOCK_API_TOKEN,
        org: {
          id: MOCK_ORG_ID,
          name: MOCK_ORG_NAME,
        },
      }
    } else {
      throw new Error('Authentication failed')
    }
  })
}

/**
 * Mock configuration storage for auth tokens.
 */
export function mockConfigStorage() {
  const storage = new Map<string, any>()

  return {
    get: vi.fn((key: string) => storage.get(key)),
    set: vi.fn((key: string, value: any) => {
      storage.set(key, value)
      return true
    }),
    unset: vi.fn((key: string) => {
      storage.delete(key)
      return true
    }),
    has: vi.fn((key: string) => storage.has(key)),
    clear: vi.fn(() => storage.clear()),
    storage, // Expose for testing
  }
}

/**
 * Mock API client with authentication.
 */
export function mockAuthenticatedApiClient(options?: {
  isAuthenticated?: boolean
}) {
  const { isAuthenticated = true } = options || {}

  return {
    isAuthenticated: vi.fn().mockReturnValue(isAuthenticated),
    getToken: vi.fn().mockReturnValue(isAuthenticated ? MOCK_API_TOKEN : null),
    setToken: vi.fn(),
    clearToken: vi.fn(),
    validateToken: vi.fn().mockResolvedValue(isAuthenticated),
    getOrganizations: vi
      .fn()
      .mockResolvedValue(
        isAuthenticated ? [{ id: MOCK_ORG_ID, name: MOCK_ORG_NAME }] : [],
      ),
  }
}

/**
 * Mock browser opener for OAuth flow.
 */
export function mockBrowserOpener() {
  return vi.fn().mockResolvedValue(undefined)
}

/**
 * Mock OAuth polling mechanism.
 */
export function mockOAuthPoller(options?: {
  shouldSucceed?: boolean
  pollCount?: number
}) {
  const { pollCount = 3, shouldSucceed = true } = options || {}
  let currentPoll = 0

  return vi.fn().mockImplementation(async () => {
    currentPoll++

    if (currentPoll < pollCount) {
      return { pending: true }
    }

    if (shouldSucceed) {
      return {
        pending: false,
        token: MOCK_API_TOKEN,
      }
    } else {
      throw new Error('OAuth timeout')
    }
  })
}

/**
 * Complete mock setup for login command testing.
 */
export function setupLoginMocks(options?: {
  authenticated?: boolean
  loginShouldSucceed?: boolean
}) {
  const { authenticated = false, loginShouldSucceed = true } = options || {}

  const configMock = mockConfigStorage()
  const apiClientMock = mockAuthenticatedApiClient({
    isAuthenticated: authenticated,
  })
  const browserMock = mockBrowserOpener()
  const authFlowMock = mockInteractiveLogin({
    shouldSucceed: loginShouldSucceed,
  })

  // Pre-populate config if authenticated.
  if (authenticated) {
    configMock.set('apiToken', MOCK_API_TOKEN)
    configMock.set('defaultOrg', MOCK_ORG_NAME)
  }

  return {
    config: configMock,
    apiClient: apiClientMock,
    browserOpener: browserMock,
    authFlow: authFlowMock,
    // Helper to verify login completed.
    expectLoginSuccess: () => {
      expect(configMock.set).toHaveBeenCalledWith('apiToken', MOCK_API_TOKEN)
    },
    // Helper to verify logout completed.
    expectLogoutSuccess: () => {
      expect(configMock.unset).toHaveBeenCalledWith('apiToken')
    },
  }
}
