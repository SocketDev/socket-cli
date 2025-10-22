/** @fileoverview Test constants for Socket CLI. Defines common test values and configuration options used across multiple test files. */

/**
 * Common test timeouts in milliseconds
 */
export const TEST_TIMEOUTS = {
  SHORT: 1000,
  MEDIUM: 5000,
  LONG: 10000,
}

/**
 * Common HTTP status codes used in tests
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
}

/**
 * Common test API URLs
 */
export const TEST_URLS = {
  API_BASE: 'https://api.socket.dev',
  API_TEST: 'https://test.api.socket.dev',
  API_CUSTOM: 'https://custom.api.com',
}

/**
 * Common test tokens
 */
export const TEST_TOKENS = {
  VALID: 'test-valid-token-12345',
  INVALID: 'invalid-token',
  EXPIRED: 'expired-token',
}

/**
 * Common test organization slugs
 */
export const TEST_ORG_SLUGS = {
  DEFAULT: 'test-org',
  ENTERPRISE: 'enterprise-org',
  PROTECTED: 'protected-org',
}

/**
 * Common test repository names
 */
export const TEST_REPO_NAMES = {
  DEFAULT: 'test-repo',
  DELETED: 'deleted-repo',
  SPECIAL: 'repo-with-hyphens_and_underscores',
  PROTECTED: 'protected-repo',
}

/**
 * Common test scan IDs
 */
export const TEST_SCAN_IDS = {
  DEFAULT: 'scan-123',
  FULL: 'full-scan-456',
  PENDING: 'pending-scan-789',
}
