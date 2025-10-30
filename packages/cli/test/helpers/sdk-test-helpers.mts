/** @fileoverview SDK test helpers for Socket CLI. Provides utilities for setting up SDK mocks with common success/error patterns. */

import { vi } from 'vitest'

import {
  createErrorResult,
  createMockSdk,
  createSuccessResult,
} from './mocks.mts'

import type { Mock } from 'vitest'

/**
 * Get the mocked handleApiCall function.
 * This must be called after vi.mock() has been executed in the test file.
 *
 * @returns The mocked handleApiCall function
 */
async function getMockHandleApiCall(): Promise<Mock> {
  const module = await vi.importMock<
    typeof import('../../src/utils/socket/api.mts')
  >('../../src/utils/socket/api.mts')
  return vi.mocked(module.handleApiCall)
}

/**
 * Get the mocked setupSdk function.
 * This must be called after vi.mock() has been executed in the test file.
 *
 * @returns The mocked setupSdk function
 */
async function getMockSetupSdk(): Promise<Mock> {
  const module = await vi.importMock<
    typeof import('../../src/utils/socket/sdk.mts')
  >('../../src/utils/socket/sdk.mts')
  return vi.mocked(module.setupSdk)
}

/**
 * Get the mocked withSdk function.
 * This must be called after vi.mock() has been executed in the test file.
 *
 * @returns The mocked withSdk function
 */
async function getMockWithSdk(): Promise<Mock> {
  const module = await vi.importMock<
    typeof import('../../src/utils/socket/sdk.mts')
  >('../../src/utils/socket/sdk.mts')
  return vi.mocked(module.withSdk)
}

/**
 * Setup SDK mock for successful API call.
 * Note: Test files must call vi.mock() for the SDK modules before using this helper.
 *
 * @param sdkMethod - The SDK method to mock (e.g., 'getOrgQuotaOverview')
 * @param mockData - The data to return in the success response
 * @returns Object with mockSdk, mockHandleApi, and mockSetupSdk references
 */
export async function setupSdkMockSuccess(sdkMethod: string, mockData: any) {
  const mockSdk = createMockSdk({
    [sdkMethod]: vi.fn().mockResolvedValue({ success: true, data: mockData }),
  })

  const setupSdk = await getMockSetupSdk()
  const handleApiCall = await getMockHandleApiCall()

  setupSdk.mockResolvedValue(createSuccessResult(mockSdk))
  handleApiCall.mockResolvedValue(createSuccessResult(mockData))

  return {
    mockHandleApi: handleApiCall,
    mockSdk,
    mockSetupSdk: setupSdk,
  }
}

/**
 * Setup SDK mock for API call error.
 * Note: Test files must call vi.mock() for the SDK modules before using this helper.
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
  const errorObj = typeof error === 'string' ? new Error(error) : error
  const mockSdk = createMockSdk({
    [sdkMethod]: vi.fn().mockRejectedValue(errorObj),
  })

  const setupSdk = await getMockSetupSdk()
  const handleApiCall = await getMockHandleApiCall()

  setupSdk.mockResolvedValue(createSuccessResult(mockSdk))
  handleApiCall.mockResolvedValue(createErrorResult(errorObj.message, { code }))

  return {
    mockHandleApi: handleApiCall,
    mockSdk,
  }
}

/**
 * Setup SDK setup failure (before API call).
 * Note: Test files must call vi.mock() for the SDK modules before using this helper.
 *
 * @param message - Error message
 * @param options - Error options (code, cause)
 */
export async function setupSdkSetupFailure(
  message: string,
  options?: { code?: number; cause?: string },
) {
  const setupSdk = await getMockSetupSdk()
  setupSdk.mockResolvedValue(createErrorResult(message, options))
}

/**
 * Setup SDK mock with custom SDK object.
 * For tests that need fine-grained control over SDK methods.
 * Note: Test files must call vi.mock() for the SDK modules before using this helper.
 *
 * @param mockSdkMethods - Object with SDK methods to mock
 * @param mockApiData - Data to return from handleApiCall
 * @returns Object with mockSdk, mockHandleApi, and mockSetupSdk
 */
export async function setupSdkMockWithCustomSdk(
  mockSdkMethods: Record<string, any>,
  mockApiData: any,
) {
  const mockSdk = createMockSdk(mockSdkMethods)

  const setupSdk = await getMockSetupSdk()
  const handleApiCall = await getMockHandleApiCall()

  setupSdk.mockResolvedValue(createSuccessResult(mockSdk))
  handleApiCall.mockResolvedValue(createSuccessResult(mockApiData))

  return {
    mockHandleApi: handleApiCall,
    mockSdk,
    mockSetupSdk: setupSdk,
  }
}

/**
 * Setup SDK mock for withSdk pattern.
 * For tests using the withSdk utility instead of setupSdk.
 * Note: Test files must call vi.mock() for the SDK modules before using this helper.
 *
 * @param callback - The function to execute with the SDK
 * @param mockSdkMethods - Object with SDK methods to mock
 * @returns Mock SDK object
 */
export async function setupWithSdkMock(
  _callback: (sdk: any) => any,
  mockSdkMethods: Record<string, any> = {},
) {
  const mockSdk = createMockSdk(mockSdkMethods)
  const withSdk = await getMockWithSdk()

  withSdk.mockImplementation(async cb => {
    return cb(mockSdk)
  })

  return mockSdk
}
