/** @fileoverview SDK test helpers for Socket CLI. Provides utilities for setting up SDK mocks with common success/error patterns. */

import { vi } from 'vitest'

import { createErrorResult, createMockSdk, createSuccessResult } from './mocks.mts'

/**
 * Setup SDK mock for successful API call
 *
 * @param sdkMethod - The SDK method to mock (e.g., 'getOrgQuotaOverview')
 * @param mockData - The data to return in the success response
 * @returns Object with mockSdk, mockHandleApi, and mockSetupSdk references
 */
export async function setupSdkMockSuccess(sdkMethod: string, mockData: any) {
  const { handleApiCall } = await import('../../src/utils/socket/api.mjs')
  const { setupSdk } = await import('../../src/utils/socket/sdk.mjs')

  const mockSdk = createMockSdk({
    [sdkMethod]: vi.fn().mockResolvedValue({ success: true, data: mockData }),
  })

  vi.mocked(setupSdk).mockResolvedValue(createSuccessResult(mockSdk))
  vi.mocked(handleApiCall).mockResolvedValue(createSuccessResult(mockData))

  return {
    mockSdk,
    mockHandleApi: vi.mocked(handleApiCall),
    mockSetupSdk: vi.mocked(setupSdk),
  }
}

/**
 * Setup SDK mock for API call error
 *
 * @param sdkMethod - The SDK method to mock
 * @param error - Error message or Error object
 * @param code - HTTP status code (default: 404)
 * @returns Object with mockSdk and mockHandleApi references
 */
export async function setupSdkMockError(
  sdkMethod: string,
  error: string | Error,
  code = 404,
) {
  const { handleApiCall } = await import('../../src/utils/socket/api.mjs')
  const { setupSdk } = await import('../../src/utils/socket/sdk.mjs')

  const errorObj = typeof error === 'string' ? new Error(error) : error
  const mockSdk = createMockSdk({
    [sdkMethod]: vi.fn().mockRejectedValue(errorObj),
  })

  vi.mocked(setupSdk).mockResolvedValue(createSuccessResult(mockSdk))
  vi.mocked(handleApiCall).mockResolvedValue(
    createErrorResult(errorObj.message, { code }),
  )

  return {
    mockSdk,
    mockHandleApi: vi.mocked(handleApiCall),
  }
}

/**
 * Setup SDK setup failure (before API call)
 *
 * @param message - Error message
 * @param options - Error options (code, cause)
 */
export async function setupSdkSetupFailure(
  message: string,
  options?: { code?: number; cause?: string },
) {
  const { setupSdk } = await import('../../src/utils/socket/sdk.mjs')

  vi.mocked(setupSdk).mockResolvedValue(
    createErrorResult(message, options),
  )
}

/**
 * Setup SDK mock with custom SDK object
 * For tests that need fine-grained control over SDK methods
 *
 * @param mockSdkMethods - Object with SDK methods to mock
 * @param mockApiData - Data to return from handleApiCall
 * @returns Object with mockSdk, mockHandleApi, and mockSetupSdk
 */
export async function setupSdkMockWithCustomSdk(
  mockSdkMethods: Record<string, any>,
  mockApiData: any,
) {
  const { handleApiCall } = await import('../../src/utils/socket/api.mjs')
  const { setupSdk } = await import('../../src/utils/socket/sdk.mjs')

  const mockSdk = createMockSdk(mockSdkMethods)

  vi.mocked(setupSdk).mockResolvedValue(createSuccessResult(mockSdk))
  vi.mocked(handleApiCall).mockResolvedValue(createSuccessResult(mockApiData))

  return {
    mockSdk,
    mockHandleApi: vi.mocked(handleApiCall),
    mockSetupSdk: vi.mocked(setupSdk),
  }
}

/**
 * Setup SDK mock for withSdk pattern
 * For tests using the withSdk utility instead of setupSdk
 *
 * @param callback - The function to execute with the SDK
 * @param mockSdkMethods - Object with SDK methods to mock
 * @returns Mock SDK object
 */
export async function setupWithSdkMock(
  callback: (sdk: any) => any,
  mockSdkMethods: Record<string, any> = {},
) {
  const { withSdk } = await import('../../src/utils/socket/sdk.mjs')

  const mockSdk = createMockSdk(mockSdkMethods)

  vi.mocked(withSdk).mockImplementation(async (cb) => {
    return cb(mockSdk)
  })

  return mockSdk
}
