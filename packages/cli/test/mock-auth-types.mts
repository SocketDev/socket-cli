/**
 * Shared types, constants, and helpers for mock authentication utilities.
 */

export interface MockAuthOptions {
  /**
   * Whether the operation should succeed.
   */
  shouldSucceed?: boolean | undefined
  /**
   * Custom delay in milliseconds to simulate network latency.
   */
  delay?: number | undefined
  /**
   * Custom error message for failure scenarios.
   */
  errorMessage?: string | undefined
  /**
   * Custom response data for success scenarios.
   */
  responseData?: unknown | undefined
}

export interface MockLoginOptions extends MockAuthOptions {
  /**
   * Mock email address for login.
   */
  email?: string | undefined
  /**
   * Mock organization slug.
   */
  orgSlug?: string | undefined
  /**
   * Mock API token to return.
   */
  apiToken?: string | undefined
  /**
   * Whether to simulate MFA requirement.
   */
  requireMfa?: boolean | undefined
}

export interface MockTokenOptions extends MockAuthOptions {
  /**
   * The token to validate.
   */
  token?: string | undefined
  /**
   * Token permissions/scopes.
   */
  scopes?: string[] | readonly string[] | undefined
  /**
   * Token expiration time.
   */
  expiresAt?: Date | undefined
}

export interface MockOrgOptions extends MockAuthOptions {
  /**
   * List of organizations to return.
   */
  organizations?:
    | Array<{
        id: string
        slug: string
        name: string
        role: string
      }>
    | undefined
  /**
   * Selected organization index.
   */
  selectedIndex?: number | undefined
}

export const MILLISECONDS_1_DAY = Date.now() + 24 * 60 * 60 * 1000

export const MILLISECONDS_30_DAYS = Date.now() + 30 * 24 * 60 * 60 * 1000

/**
 * Simulate a delay for realistic async behavior.
 */
export function simulateDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
