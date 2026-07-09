/**
 * Mock authentication utilities for API tokens and API keys.
 */

import type { CResult } from '../src/types.mts'
import type { MockAuthOptions, MockTokenOptions } from './mock-auth-types.mts'
import { MILLISECONDS_30_DAYS, simulateDelay } from './mock-auth-types.mts'

/**
 * Mock API token authentication.
 */
export async function mockApiTokenAuth(
  options?: MockTokenOptions,
): Promise<CResult<{ valid: boolean; user?: unknown | undefined }>> {
  const {
    delay = 50,
    errorMessage = 'Invalid token',
    expiresAt = new Date(MILLISECONDS_30_DAYS),
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
 * Mock API key generation.
 */
export async function mockGenerateApiKey(
  options?: MockAuthOptions & {
    keyName?: string | undefined
    scopes?: string[] | undefined
  },
): Promise<CResult<{ apiKey: string; keyId: string }>> {
  const {
    delay = 150,
    errorMessage = 'API key generation failed',
    keyName = 'test-key',
    shouldSucceed = true,
  } = {
    __proto__: null,
    ...options,
  } as MockAuthOptions & {
    keyName?: string | undefined
    scopes?: string[] | undefined
  }

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
