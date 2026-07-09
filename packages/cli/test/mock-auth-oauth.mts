/**
 * Mock authentication utilities for OAuth-style flows (GitHub, SSO).
 */

import type { CResult } from '../src/types.mts'
import type { MockAuthOptions } from './mock-auth-types.mts'
import { simulateDelay } from './mock-auth-types.mts'

/**
 * Mock GitHub OAuth authentication flow.
 */
export async function mockGitHubAuth(
  options?: MockAuthOptions & { code?: string | undefined },
): Promise<CResult<{ accessToken: string; user: unknown }>> {
  const {
    code = 'github-auth-code-123',
    delay = 200,
    errorMessage = 'GitHub authentication failed',
    shouldSucceed = true,
  } = {
    __proto__: null,
    ...options,
  } as MockAuthOptions & { code?: string | undefined }

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
 * Mock SSO authentication flow.
 */
export async function mockSsoAuth(
  options?: MockAuthOptions & {
    ssoProvider?: string | undefined
    ssoOrgSlug?: string | undefined
  },
): Promise<CResult<{ apiToken: string; user: unknown }>> {
  const {
    delay = 300,
    errorMessage = 'SSO authentication failed',
    shouldSucceed = true,
    ssoOrgSlug = 'sso-org',
    ssoProvider = 'okta',
  } = {
    __proto__: null,
    ...options,
  } as MockAuthOptions & {
    ssoProvider?: string | undefined
    ssoOrgSlug?: string | undefined
  }

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
