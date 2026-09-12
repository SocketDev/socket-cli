/**
 * @file Test mock helpers for Socket CLI. Provides utilities for mocking SDK,
 *   API, logger, and output functions consistently across test files.
 */

import { vi } from 'vitest'

import type { CResult } from '../../src/types.mts'
import type { SocketSdk } from '@socketsecurity/sdk-stable'

/**
 * Error options for creating error results.
 */
type ErrorOptions = {
  code?: number | undefined
  cause?: string | undefined
}

/**
 * Creates a failed CResult.
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
 * Creates mock logger functions.
 */
/**
 * A SocketSdk whose methods are all vi.fn() mocks. The mapped Mock
 * intersection keeps `expect(mockSdk.method)` assertions clear of the
 * type-aware unbound-method rule, which flags references to real class
 * methods.
 */
export type MockSocketSdk = {
  [K in keyof SocketSdk]: ReturnType<typeof vi.fn>
}

/**
 * Creates a mock Socket SDK with common methods.
 */
export function createMockSdk(
  overrides: Partial<SocketSdk> = {},
): MockSocketSdk {
  // Tests substitute a vitest-mock-shaped object for the real SocketSdk; this
  // is intentionally structural so command code under test sees a method to call.
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
  } as unknown as MockSocketSdk
}

/**
 * Creates a successful CResult.
 */
export function createSuccessResult<T>(data: T): CResult<T> {
  return {
    ok: true,
    data,
  }
}

/**
 * Setup SDK setup failure mock.
 */
export async function setupSdkSetupFailure(
  message: string,
  cause?: string | undefined,
): Promise<void> {
  const { setupSdk } = await import('../../src/util/socket/sdk.mts')
  const options: ErrorOptions = cause !== undefined ? { cause } : {}
  vi.mocked(setupSdk).mockResolvedValue(createErrorResult(message, options))
}
