/**
 * Mock authentication utilities for Socket CLI testing. Provides mock functions
 * for authentication flows.
 *
 * Key Functions: - mockInteractiveLogin: Mock interactive login flow -
 * mockApiTokenAuth: Mock API token authentication - mockGitHubAuth: Mock GitHub
 * OAuth flow - mockOrgSelection: Mock organization selection -
 * mockTokenValidation: Mock token validation.
 *
 * Features: - Configurable success/failure scenarios - Customizable response
 * data - Delay simulation for realistic testing - Error state testing.
 *
 * Usage: - Unit testing authentication flows - Integration testing without real
 * API calls - E2E testing with controlled responses.
 */

export type {
  MockAuthOptions,
  MockLoginOptions,
  MockOrgOptions,
  MockTokenOptions,
} from './mock-auth-types.mts'
export { simulateDelay } from './mock-auth-types.mts'

export { mockGitHubAuth, mockSsoAuth } from './mock-auth-oauth.mts'

export {
  mockInteractiveLogin,
  mockLogout,
  mockOrgSelection,
  mockRefreshToken,
  mockValidateSession,
} from './mock-auth-session.mts'

export {
  mockApiTokenAuth,
  mockGenerateApiKey,
  mockTokenValidation,
} from './mock-auth-tokens.mts'
