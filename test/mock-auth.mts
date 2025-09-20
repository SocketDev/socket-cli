/**
 * Mock authentication utilities for Socket CLI testing.
 * Provides mock functions for authentication flows.
 *
 * Key Functions:
 * - mockInteractiveLogin: Mock interactive login flow
 * - mockApiTokenAuth: Mock API token authentication
 * - mockGitHubAuth: Mock GitHub OAuth flow
 * - mockOrgSelection: Mock organization selection
 * - mockTokenValidation: Mock token validation
 *
 * Features:
 * - Configurable success/failure scenarios
 * - Customizable response data
 * - Delay simulation for realistic testing
 * - Error state testing
 *
 * Usage:
 * - Unit testing authentication flows
 * - Integration testing without real API calls
 * - E2E testing with controlled responses
 */

import type { CResult } from '../src/types.mts'

export interface MockAuthOptions {
  /** Whether the operation should succeed. */
  shouldSucceed?: boolean
  /** Custom delay in milliseconds to simulate network latency. */
  delay?: number
  /** Custom error message for failure scenarios. */
  errorMessage?: string
  /** Custom response data for success scenarios. */
  responseData?: any
}

export interface MockLoginOptions extends MockAuthOptions {
  /** Mock email address for login. */
  email?: string
  /** Mock organization slug. */
  orgSlug?: string
  /** Mock API token to return. */
  apiToken?: string
  /** Whether to simulate MFA requirement. */
  requireMfa?: boolean
}

export interface MockTokenOptions extends MockAuthOptions {
  /** The token to validate. */
  token?: string
  /** Token permissions/scopes. */
  scopes?: string[]
  /** Token expiration time. */
  expiresAt?: Date
}

export interface MockOrgOptions extends MockAuthOptions {
  /** List of organizations to return. */
  organizations?: Array<{
    id: string
    slug: string
    name: string
    role: string
  }>
  /** Selected organization index. */
  selectedIndex?: number
}

/**
 * Simulate a delay for realistic async behavior.
 */
function simulateDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Mock interactive login flow.
 */
export async function mockInteractiveLogin(
  options?: MockLoginOptions,
): Promise<CResult<{ apiToken: string; orgSlug: string }>> {
  const {
    apiToken = 'test-token-123',
    delay = 100,
    errorMessage = 'Login failed',
    orgSlug = 'test-org',
    requireMfa = false,
    shouldSucceed = true,
  } = {
    __proto__: null,
    ...options,
  } as MockLoginOptions

  await simulateDelay(delay)

  if (!shouldSucceed) {
    return {
      ok: false,
      code: 401,
      message: errorMessage,
    }
  }

  if (requireMfa) {
    // Simulate MFA flow.
    await simulateDelay(delay)
  }

  return {
    ok: true,
    data: {
      apiToken,
      orgSlug,
    },
  }
}

/**
 * Mock API token authentication.
 */
export async function mockApiTokenAuth(
  options?: MockTokenOptions,
): Promise<CResult<{ valid: boolean; user?: any }>> {
  const {
    delay = 50,
    errorMessage = 'Invalid token',
    expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days.
    scopes = ['read', 'write'],
    shouldSucceed = true,
    token = 'test-token',
  } = {
    __proto__: null,
    ...options,
  } as MockTokenOptions

  await simulateDelay(delay)

  if (!shouldSucceed) {
    return {
      ok: false,
      code: 401,
      message: errorMessage,
    }
  }

  return {
    ok: true,
    data: {
      valid: true,
      user: {
        id: 'user-123',
        email: 'test@example.com',
        token,
        scopes,
        expiresAt,
      },
    },
  }
}

/**
 * Mock GitHub OAuth authentication flow.
 */
export async function mockGitHubAuth(
  options?: MockAuthOptions & { code?: string },
): Promise<CResult<{ accessToken: string; user: any }>> {
  const {
    code = 'github-auth-code-123',
    delay = 200,
    errorMessage = 'GitHub authentication failed',
    shouldSucceed = true,
  } = {
    __proto__: null,
    ...options,
  } as MockAuthOptions & { code?: string }

  await simulateDelay(delay)

  if (!shouldSucceed) {
    return {
      ok: false,
      code: 403,
      message: errorMessage,
    }
  }

  return {
    ok: true,
    data: {
      accessToken: `gho_${code}_accesstoken`,
      user: {
        id: 'github-user-123',
        login: 'testuser',
        email: 'test@github.com',
        name: 'Test User',
      },
    },
  }
}

/**
 * Mock organization selection.
 */
export async function mockOrgSelection(
  options?: MockOrgOptions,
): Promise<CResult<{ orgSlug: string; orgId: string }>> {
  const {
    delay = 50,
    errorMessage = 'Organization selection failed',
    organizations = [
      { id: 'org-1', slug: 'test-org-1', name: 'Test Org 1', role: 'admin' },
      { id: 'org-2', slug: 'test-org-2', name: 'Test Org 2', role: 'member' },
    ],
    selectedIndex = 0,
    shouldSucceed = true,
  } = {
    __proto__: null,
    ...options,
  } as MockOrgOptions

  await simulateDelay(delay)

  if (!shouldSucceed) {
    return {
      ok: false,
      code: 500,
      message: errorMessage,
    }
  }

  if (!organizations.length) {
    return {
      ok: false,
      code: 404,
      message: 'No organizations available',
    }
  }

  const selected = organizations[selectedIndex]
  if (!selected) {
    return {
      ok: false,
      code: 400,
      message: 'Invalid organization selection',
    }
  }

  return {
    ok: true,
    data: {
      orgSlug: selected.slug,
      orgId: selected.id,
    },
  }
}

/**
 * Mock token validation.
 */
export async function mockTokenValidation(
  token: string,
  options?: MockAuthOptions,
): Promise<CResult<boolean>> {
  const {
    delay = 30,
    errorMessage = 'Token validation failed',
    shouldSucceed = true,
  } = {
    __proto__: null,
    ...options,
  } as MockAuthOptions

  await simulateDelay(delay)

  if (!shouldSucceed) {
    return {
      ok: false,
      code: 401,
      message: errorMessage,
    }
  }

  // Simulate basic token validation.
  const isValid = token.length > 10 && token.startsWith('test-')

  return {
    ok: true,
    data: isValid,
  }
}

/**
 * Mock SSO authentication flow.
 */
export async function mockSsoAuth(
  options?: MockAuthOptions & { ssoProvider?: string; ssoOrgSlug?: string },
): Promise<CResult<{ apiToken: string; user: any }>> {
  const {
    delay = 300,
    errorMessage = 'SSO authentication failed',
    shouldSucceed = true,
    ssoOrgSlug = 'sso-org',
    ssoProvider = 'okta',
  } = {
    __proto__: null,
    ...options,
  } as MockAuthOptions & { ssoProvider?: string; ssoOrgSlug?: string }

  await simulateDelay(delay)

  if (!shouldSucceed) {
    return {
      ok: false,
      code: 403,
      message: errorMessage,
    }
  }

  return {
    ok: true,
    data: {
      apiToken: `sso-token-${ssoProvider}-${Date.now()}`,
      user: {
        id: 'sso-user-123',
        email: `user@${ssoOrgSlug}.com`,
        name: 'SSO User',
        provider: ssoProvider,
        orgSlug: ssoOrgSlug,
      },
    },
  }
}

/**
 * Mock refresh token flow.
 */
export async function mockRefreshToken(
  _refreshToken: string,
  options?: MockAuthOptions,
): Promise<CResult<{ accessToken: string; expiresIn: number }>> {
  const {
    delay = 100,
    errorMessage = 'Token refresh failed',
    shouldSucceed = true,
  } = {
    __proto__: null,
    ...options,
  } as MockAuthOptions

  await simulateDelay(delay)

  if (!shouldSucceed) {
    return {
      ok: false,
      code: 401,
      message: errorMessage,
    }
  }

  return {
    ok: true,
    data: {
      accessToken: `refreshed-token-${Date.now()}`,
      expiresIn: 3600, // 1 hour.
    },
  }
}

/**
 * Mock logout flow.
 */
export async function mockLogout(
  options?: MockAuthOptions,
): Promise<CResult<void>> {
  const {
    delay = 50,
    errorMessage = 'Logout failed',
    shouldSucceed = true,
  } = {
    __proto__: null,
    ...options,
  } as MockAuthOptions

  await simulateDelay(delay)

  if (!shouldSucceed) {
    return {
      ok: false,
      code: 500,
      message: errorMessage,
    }
  }

  return {
    ok: true,
    data: undefined,
  }
}

/**
 * Mock API key generation.
 */
export async function mockGenerateApiKey(
  options?: MockAuthOptions & { keyName?: string; scopes?: string[] },
): Promise<CResult<{ apiKey: string; keyId: string }>> {
  const {
    delay = 150,
    errorMessage = 'API key generation failed',
    keyName = 'test-key',
    shouldSucceed = true,
  } = {
    __proto__: null,
    ...options,
  } as MockAuthOptions & { keyName?: string; scopes?: string[] }

  await simulateDelay(delay)

  if (!shouldSucceed) {
    return {
      ok: false,
      code: 500,
      message: errorMessage,
    }
  }

  return {
    ok: true,
    data: {
      apiKey: `sk_test_${Buffer.from(keyName).toString('base64').substring(0, 16)}`,
      keyId: `key_${Date.now()}`,
    },
  }
}

/**
 * Mock session validation.
 */
export async function mockValidateSession(
  sessionId: string,
  options?: MockAuthOptions,
): Promise<CResult<{ valid: boolean; expiresAt?: Date | undefined }>> {
  const {
    delay = 50,
    errorMessage = 'Session validation failed',
    shouldSucceed = true,
  } = {
    __proto__: null,
    ...options,
  } as MockAuthOptions

  await simulateDelay(delay)

  if (!shouldSucceed) {
    return {
      ok: false,
      code: 401,
      message: errorMessage,
    }
  }

  const isValid = sessionId.startsWith('sess_')

  return {
    ok: true,
    data: {
      valid: isValid,
      expiresAt: isValid
        ? new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours.
        : undefined,
    },
  }
}
