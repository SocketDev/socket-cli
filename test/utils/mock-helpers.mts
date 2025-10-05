/** @fileoverview Test mock helpers for Socket CLI. Provides utilities for mocking SDK, API, logger, and output functions consistently across test files. */

import { vi } from 'vitest'

import type { CResult } from '../../src/types.mts'
import type { SocketSdk } from '@socketsecurity/sdk'

/**
 * Error options for creating error results
 */
export type ErrorOptions = {
  code?: number | undefined
  cause?: string | undefined
}

/**
 * Creates mock functions for SDK and API utilities
 */
export function createSdkMocks() {
  return {
    handleApiCall: vi.fn(),
    setupSdk: vi.fn(),
    withSdk: vi.fn(),
  }
}

/**
 * Creates a mock Socket SDK with common methods
 */
export function createMockSdk(overrides: Partial<SocketSdk> = {}): any {
  return {
    deleteOrgRepo: vi.fn(),
    createOrgRepo: vi.fn(),
    getOrgRepo: vi.fn(),
    getOrgRepoList: vi.fn(),
    updateOrgRepo: vi.fn(),
    getQuota: vi.fn(),
    getOrganizations: vi.fn(),
    deleteOrgFullScan: vi.fn(),
    getOrgFullScanList: vi.fn(),
    getOrgFullScanMetadata: vi.fn(),
    getSupportedScanFiles: vi.fn(),
    getOrgAnalytics: vi.fn(),
    getRepoAnalytics: vi.fn(),
    batchPackageFetch: vi.fn(),
    ...overrides,
  }
}

/**
 * Creates a successful CResult
 */
export function createSuccessResult<T>(data: T): CResult<T> {
  return {
    ok: true,
    data,
  }
}

/**
 * Creates a failed CResult
 */
export function createErrorResult(
  message: string,
  options?: ErrorOptions | undefined,
): CResult<never> {
  const opts = { __proto__: null, ...options } as ErrorOptions
  return {
    ok: false,
    message,
    code: opts.code ?? 1,
    cause: opts.cause,
  }
}

/**
 * Creates mock logger functions
 */
export function createLoggerMocks() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fail: vi.fn(),
    success: vi.fn(),
  }
}

/**
 * Creates mock output utility functions
 */
export function createOutputMocks() {
  return {
    failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
    serializeResultJson: vi.fn(result => JSON.stringify(result)),
  }
}

/**
 * Setup common module mocks for SDK operations
 */
export function setupSdkModuleMocks() {
  vi.mock('../../utils/api.mts', () => ({
    handleApiCall: vi.fn(),
  }))

  vi.mock('../../utils/sdk.mts', () => ({
    setupSdk: vi.fn(),
    withSdk: vi.fn(),
  }))
}

/**
 * Setup common module mocks for output operations
 */
export function setupOutputModuleMocks() {
  vi.mock('@socketsecurity/registry/lib/logger', () => ({
    logger: {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    },
  }))

  vi.mock('../../utils/fail-msg-with-badge.mts', () => ({
    failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
  }))

  vi.mock('../../utils/serialize-result-json.mts', () => ({
    serializeResultJson: vi.fn(result => JSON.stringify(result)),
  }))
}

/**
 * Setup successful SDK mock chain
 */
export async function setupSuccessfulSdkChain(
  sdkMethod: string,
  mockData: any,
): Promise<void> {
  const { handleApiCall } = await import('../../src/utils/api.mts')
  const { setupSdk } = await import('../../src/utils/sdk.mts')

  const mockSdk = createMockSdk({
    [sdkMethod]: vi.fn().mockResolvedValue({
      success: true,
      data: mockData,
    }),
  })

  vi.mocked(setupSdk).mockResolvedValue(createSuccessResult(mockSdk))
  vi.mocked(handleApiCall).mockResolvedValue(createSuccessResult(mockData))
}

/**
 * Setup SDK setup failure mock
 */
export async function setupSdkSetupFailure(
  message: string,
  cause?: string | undefined,
): Promise<void> {
  const { setupSdk } = await import('../../src/utils/sdk.mts')
  const options: ErrorOptions = cause !== undefined ? { cause } : {}
  vi.mocked(setupSdk).mockResolvedValue(createErrorResult(message, options))
}

/**
 * Setup API call failure mock
 */
export async function setupApiCallFailure(
  sdkMethod: string,
  error: Error | string,
  code = 404,
): Promise<void> {
  const { handleApiCall } = await import('../../src/utils/api.mts')
  const { setupSdk } = await import('../../src/utils/sdk.mts')

  const errorObj = typeof error === 'string' ? new Error(error) : error
  const mockSdk = createMockSdk({
    [sdkMethod]: vi.fn().mockRejectedValue(errorObj),
  })

  vi.mocked(setupSdk).mockResolvedValue(createSuccessResult(mockSdk))
  vi.mocked(handleApiCall).mockResolvedValue(
    createErrorResult(errorObj.message, { code }),
  )
}
