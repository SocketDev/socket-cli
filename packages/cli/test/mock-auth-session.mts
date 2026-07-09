/**
 * Mock authentication utilities for login, session, and organization flows.
 */

import type { CResult } from '../src/types.mts'
import type {
  MockAuthOptions,
  MockLoginOptions,
  MockOrgOptions,
} from './mock-auth-types.mts'
import { MILLISECONDS_1_DAY, simulateDelay } from './mock-auth-types.mts'

/**
 * Mock interactive login flow.
 */
export async function mockInteractiveLogin(
  options?: MockLoginOptions | undefined,
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
      expiresAt: isValid ? new Date(MILLISECONDS_1_DAY) : undefined,
    },
  }
}
