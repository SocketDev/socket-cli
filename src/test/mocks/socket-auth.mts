/**
 * Mock utilities for Socket authentication and login flow.
 * Provides test doubles for authentication-related functionality.
 */

import type { Mock } from 'vitest'
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

type MockFunction<Args extends unknown[], Result> = Mock<
  (...args: Args) => Result
>

interface MockConfigStorage {
  get: Mock<(key: string) => unknown>
  set: Mock<(key: string, value: unknown) => boolean>
  unset: Mock<(key: string) => boolean>
  has: Mock<(key: string) => boolean>
  clear: Mock<() => void>
  storage: Map<string, unknown>
}

interface MockAuthenticatedApiClient {
  isAuthenticated: Mock<() => boolean>
  getToken: Mock<() => string | null>
  setToken: Mock<(...args: unknown[]) => unknown>
  clearToken: Mock<(...args: unknown[]) => unknown>
  validateToken: Mock<() => Promise<boolean>>
  getOrganizations: Mock<() => Promise<Array<{ id: string; name: string }>>>
}

/**
 * Mock the interactive login flow.
 * Simulates opening browser, polling for auth completion.
 */
export function mockInteractiveLogin(options?: {
  shouldSucceed?: boolean
}): MockFunction<[], Promise<MockAuthResponse>> {
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
    }
    throw new Error('Authentication failed')
  })
}

/**
 * Mock configuration storage for auth tokens.
 */
export function mockConfigStorage(): MockConfigStorage {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn((key: string) => storage.get(key)),
    set: vi.fn((key: string, value: unknown) => {
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
}): MockAuthenticatedApiClient {
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
export function mockBrowserOpener(): MockFunction<
  [...args: unknown[]],
  Promise<void>
> {
  return vi.fn().mockResolvedValue(undefined)
}

/**
 * Mock OAuth polling mechanism.
 */
export function mockOAuthPoller(options?: {
  shouldSucceed?: boolean
  pollCount?: number
}): MockFunction<[], Promise<{ pending: boolean; token?: string }>> {
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
    }
    throw new Error('OAuth timeout')
  })
}

/**
 * Complete mock setup for login command testing.
 */
export function setupLoginMocks(options?: {
  authenticated?: boolean
  loginShouldSucceed?: boolean
}): {
  config: MockConfigStorage
  apiClient: MockAuthenticatedApiClient
  browserOpener: ReturnType<typeof mockBrowserOpener>
  authFlow: ReturnType<typeof mockInteractiveLogin>
  expectLoginSuccess: () => void
  expectLogoutSuccess: () => void
} {
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
