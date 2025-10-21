/** @fileoverview Test fixtures and data configurations for Socket CLI. Provides standard test data for common entities like repositories, organizations, and scans. */

import type { CResult, OutputKind } from '../../src/types.mts'

/**
 * Standard output kinds for testing
 */
export const OUTPUT_KINDS: OutputKind[] = ['json', 'markdown', 'text']

/**
 * Test repository configurations
 */
export const TEST_REPOS = {
  default: {
    orgSlug: 'test-org',
    repoName: 'test-repo',
    defaultBranch: 'main',
    description: 'Test repository',
    homepage: 'https://example.com',
    visibility: 'public',
  },
  deleted: {
    orgSlug: 'test-org',
    repoName: 'deleted-repo',
  },
  special: {
    orgSlug: 'special-org',
    repoName: 'repo-with-hyphens_and_underscores',
  },
  protected: {
    orgSlug: 'protected-org',
    repoName: 'protected-repo',
  },
}

/**
 * Test organization configurations
 */
export const TEST_ORGS = {
  default: {
    orgSlug: 'test-org',
    name: 'Test Organization',
    plan: 'free',
  },
  enterprise: {
    orgSlug: 'enterprise-org',
    name: 'Enterprise Organization',
    plan: 'enterprise',
  },
}

/**
 * Test scan configurations
 */
export const TEST_SCANS = {
  default: {
    orgSlug: 'test-org',
    scanId: 'scan-123',
    repoName: 'test-repo',
    branch: 'main',
  },
  fullScan: {
    orgSlug: 'test-org',
    scanId: 'full-scan-456',
    repoName: 'full-repo',
    branch: 'develop',
    commitHash: 'abc123',
    commitMessage: 'Test commit',
    committers: 'test-user',
    pullRequest: 42,
  },
}

/**
 * Test SDK options configurations
 */
export const TEST_SDK_OPTIONS = {
  default: {
    apiToken: 'test-token',
    baseUrl: 'https://api.socket.dev',
  },
  custom: {
    apiToken: 'custom-token',
    baseUrl: 'https://custom.api.com',
  },
  delete: {
    apiToken: 'delete-token',
    baseUrl: 'https://delete.api.com',
  },
}

/**
 * Test quota data
 */
export const TEST_QUOTA = {
  full: { quota: 1000 },
  half: { quota: 500 },
  low: { quota: 100 },
  empty: { quota: 0 },
}

/**
 * Test analytics data
 */
export const TEST_ANALYTICS = {
  org: {
    alerts: 42,
    issues: 12,
    repositories: 5,
  },
  repo: {
    alerts: 10,
    issues: 3,
    dependencies: 50,
  },
}

/**
 * Common error configurations
 */
export const TEST_ERRORS = {
  unauthorized: {
    code: 401,
    message: 'Unauthorized',
    cause: 'Invalid API token',
  },
  forbidden: {
    code: 403,
    message: 'Insufficient permissions',
    cause: 'User does not have access',
  },
  notFound: {
    code: 404,
    message: 'Not found',
    cause: 'Resource does not exist',
  },
  sdkSetup: {
    code: 1,
    message: 'Failed to setup SDK',
    cause: 'Missing API token',
  },
  network: {
    code: 1,
    message: 'Network error',
    cause: 'Connection timeout',
  },
}

/**
 * Create a test CResult with success data
 */
export function createTestSuccessResult<T>(data: T): CResult<T> {
  return {
    ok: true,
    data,
  }
}

/**
 * Create a test CResult with error
 */
export function createTestErrorResult(
  errorKey: keyof typeof TEST_ERRORS,
): CResult<never> {
  const error = TEST_ERRORS[errorKey]
  return {
    ok: false,
    code: error.code,
    message: error.message,
    cause: error.cause,
  }
}
