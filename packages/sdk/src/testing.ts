/**
 * @fileoverview Testing utilities for Socket SDK.
 * Provides mock factories, response builders, and test helpers for easier SDK testing.
 */

import type {
  SocketSdkErrorResult,
  SocketSdkGenericResult,
  SocketSdkOperations,
  SocketSdkResult,
  SocketSdkSuccessResult,
} from './types'

/**
 * Create a successful SDK response.
 *
 * @template T - The data type
 * @param data - The response data
 * @param status - HTTP status code (default: 200)
 * @returns A successful SDK result
 *
 * @example
 * ```ts
 * const response = mockSuccessResponse({ id: '123', name: 'test' })
 * expect(response.success).toBe(true)
 * ```
 */
export function mockSuccessResponse<T>(
  data: T,
  status = 200,
): SocketSdkGenericResult<T> {
  return {
    cause: undefined,
    data,
    error: undefined,
    status,
    success: true,
  }
}

/**
 * Create an error SDK response.
 *
 * @template T - The data type (unused in error responses)
 * @param error - The error message
 * @param status - HTTP status code (default: 500)
 * @param cause - Optional error cause
 * @returns An error SDK result
 *
 * @example
 * ```ts
 * const response = mockErrorResponse('Not found', 404)
 * expect(response.success).toBe(false)
 * ```
 */
export function mockErrorResponse<T>(
  error: string,
  status = 500,
  cause?: string,
): SocketSdkGenericResult<T> {
  return {
    cause,
    data: undefined,
    error,
    status,
    success: false,
  }
}

/**
 * Create a mock Socket API error response body.
 *
 * @param message - Error message
 * @param details - Optional error details
 * @returns Socket API error response structure
 *
 * @example
 * ```ts
 * nock('https://api.socket.dev')
 *   .get('/v0/repo/org/repo')
 *   .reply(404, mockApiErrorBody('Repository not found'))
 * ```
 */
export function mockApiErrorBody(
  message: string,
  details?: Record<string, unknown>,
): { error: { message: string; details?: Record<string, unknown> } } {
  return {
    error: {
      message,
      ...(details ? { details } : {}),
    },
  }
}

/**
 * Common fixture data for organization responses.
 */
export const organizationFixtures = {
  /**
   * Basic organization with minimal data.
   */
  basic: {
    id: 'org_123',
    name: 'test-org',
    plan: 'free',
  },
  /**
   * Organization with full details.
   */
  full: {
    id: 'org_123',
    name: 'test-org',
    plan: 'enterprise',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
} as const

/**
 * Common fixture data for repository responses.
 */
export const repositoryFixtures = {
  /**
   * Basic repository with minimal data.
   */
  basic: {
    id: 'repo_123',
    name: 'test-repo',
    archived: false,
    default_branch: 'main',
  },
  /**
   * Archived repository.
   */
  archived: {
    id: 'repo_456',
    name: 'old-repo',
    archived: true,
    default_branch: 'master',
  },
  /**
   * Repository with full details.
   */
  full: {
    id: 'repo_123',
    name: 'test-repo',
    archived: false,
    default_branch: 'main',
    homepage: 'https://example.com',
    visibility: 'public',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
} as const

/**
 * Common fixture data for scan responses.
 */
export const scanFixtures = {
  /**
   * Pending scan.
   */
  pending: {
    id: 'scan_pending',
    status: 'pending',
    created_at: '2024-01-01T00:00:00Z',
  },
  /**
   * Completed scan with no issues.
   */
  completed: {
    id: 'scan_completed',
    status: 'completed',
    created_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:01:00Z',
    issues_found: 0,
  },
  /**
   * Completed scan with issues.
   */
  withIssues: {
    id: 'scan_with_issues',
    status: 'completed',
    created_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:01:00Z',
    issues_found: 3,
  },
  /**
   * Failed scan.
   */
  failed: {
    id: 'scan_failed',
    status: 'failed',
    created_at: '2024-01-01T00:00:00Z',
    error: 'Scan timeout',
  },
} as const

/**
 * Common fixture data for package/artifact responses.
 */
export const packageFixtures = {
  /**
   * Safe package with high score.
   */
  safe: {
    id: 'pkg_safe',
    name: 'safe-package',
    version: '1.0.0',
    score: 95,
  },
  /**
   * Package with vulnerabilities.
   */
  vulnerable: {
    id: 'pkg_vuln',
    name: 'vulnerable-package',
    version: '2.0.0',
    score: 45,
    issues: ['vulnerability'],
  },
  /**
   * Package with malware alert.
   */
  malware: {
    id: 'pkg_malware',
    name: 'malware-package',
    version: '3.0.0',
    score: 0,
    issues: ['malware'],
  },
} as const

/**
 * Common fixture data for issue/alert responses.
 */
export const issueFixtures = {
  /**
   * Vulnerability issue.
   */
  vulnerability: {
    type: 'vulnerability',
    severity: 'high',
    key: 'CVE-2024-1234',
    description: 'SQL Injection vulnerability',
  },
  /**
   * Malware issue.
   */
  malware: {
    type: 'malware',
    severity: 'critical',
    key: 'malware-detected',
    description: 'Malicious code detected',
  },
  /**
   * License issue.
   */
  license: {
    type: 'license',
    severity: 'medium',
    key: 'license-incompatible',
    description: 'License incompatible with project',
  },
} as const

/**
 * All fixture categories in one object.
 */
export const fixtures = {
  issues: issueFixtures,
  organizations: organizationFixtures,
  packages: packageFixtures,
  repositories: repositoryFixtures,
  scans: scanFixtures,
} as const

/**
 * Mock SDK method result with proper typing.
 *
 * @template T - The operation type
 * @param success - Whether the operation succeeded
 * @param data - Success data or error details
 * @returns Properly typed SDK result
 *
 * @example
 * ```ts
 * const mockGet = vi.fn().mockResolvedValue(
 *   mockSdkResult<'getRepo'>(true, { id: '123', name: 'repo' })
 * )
 * ```
 */
export function mockSdkResult<T extends SocketSdkOperations>(
  success: true,
  data: SocketSdkSuccessResult<T>['data'],
  status?: number,
): SocketSdkSuccessResult<T>
export function mockSdkResult<T extends SocketSdkOperations>(
  success: false,
  error: string,
  status?: number,
  cause?: string,
): SocketSdkErrorResult<T>
export function mockSdkResult<T extends SocketSdkOperations>(
  success: boolean,
  dataOrError: unknown,
  status = success ? 200 : 500,
  cause?: string,
): SocketSdkResult<T> {
  if (success) {
    return {
      cause: undefined,
      data: dataOrError,
      error: undefined,
      status,
      success: true,
    } as SocketSdkSuccessResult<T>
  }
  return {
    cause,
    data: undefined,
    error: dataOrError as string,
    status,
    success: false,
  } as SocketSdkErrorResult<T>
}

/**
 * Create a mock SDK error with proper structure.
 *
 * @param type - Error type ('NOT_FOUND', 'UNAUTHORIZED', etc.)
 * @param options - Error options
 * @returns Error response matching SDK structure
 *
 * @example
 * ```ts
 * const mockMethod = vi.fn().mockRejectedValue(
 *   mockSdkError('NOT_FOUND', { status: 404, message: 'Repository not found' })
 * )
 * ```
 */
export function mockSdkError(
  type: 'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'SERVER_ERROR' | 'TIMEOUT',
  options: {
    cause?: string
    message?: string
    status?: number
  } = {},
): Error & { status: number; cause?: string } {
  const statusMap = {
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    SERVER_ERROR: 500,
    TIMEOUT: 408,
    UNAUTHORIZED: 401,
  }

  const messageMap = {
    FORBIDDEN: 'Access forbidden',
    NOT_FOUND: 'Resource not found',
    SERVER_ERROR: 'Internal server error',
    TIMEOUT: 'Request timeout',
    UNAUTHORIZED: 'Unauthorized',
  }

  const status = options.status ?? statusMap[type]
  const message = options.message ?? messageMap[type]

  const error = new Error(message) as Error & {
    status: number
    cause?: string
  }
  error.status = status
  if (options.cause) {
    error.cause = options.cause
  }

  return error
}

/**
 * Type guard to check if SDK result is successful.
 *
 * @param result - SDK result to check
 * @returns True if result is successful
 *
 * @example
 * ```ts
 * const result = await sdk.getRepo('org', 'repo')
 * if (isSuccessResult(result)) {
 *   console.log(result.data.name) // Type-safe access
 * }
 * ```
 */
export function isSuccessResult<T>(
  result: SocketSdkGenericResult<T>,
): result is Extract<SocketSdkGenericResult<T>, { success: true }> {
  return result.success === true
}

/**
 * Type guard to check if SDK result is an error.
 *
 * @param result - SDK result to check
 * @returns True if result is an error
 *
 * @example
 * ```ts
 * const result = await sdk.getRepo('org', 'repo')
 * if (isErrorResult(result)) {
 *   console.error(result.error) // Type-safe access
 * }
 * ```
 */
export function isErrorResult<T>(
  result: SocketSdkGenericResult<T>,
): result is Extract<SocketSdkGenericResult<T>, { success: false }> {
  return result.success === false
}
