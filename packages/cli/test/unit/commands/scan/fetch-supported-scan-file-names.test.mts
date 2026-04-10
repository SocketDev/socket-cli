/**
 * Unit tests for fetchSupportedScanFileNames.
 *
 * Tests fetching supported manifest file names for scanning.
 * Validates which files Socket can analyze via the SDK v4 getSupportedFiles API.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../../test/helpers/sdk-test-helpers.mts'

// Mock the dependencies.
const mockHandleApiCall = vi.hoisted(() => vi.fn())
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockGetDefaultOrgSlug = vi.hoisted(() => vi.fn())

vi.mock('../../../../../src/utils/socket/api.mts', () => ({
  handleApiCall: mockHandleApiCall,
}))

vi.mock('../../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: mockSetupSdk,
}))

vi.mock('../../../../../src/commands/ci/fetch-default-org-slug.mts', () => ({
  getDefaultOrgSlug: mockGetDefaultOrgSlug,
}))

describe('fetchSupportedScanFileNames', () => {
  it('fetches supported scan file names successfully', async () => {
    const { fetchSupportedScanFileNames } =
      await import('../../../../../src/commands/scan/fetch-supported-scan-file-names.mts')

    const mockData = {
      supportedFiles: ['package.json', 'yarn.lock', 'composer.json'],
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getSupportedFiles',
      mockData,
    )
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'test-org' })

    const result = await fetchSupportedScanFileNames()

    expect(mockSdk.getSupportedFiles).toHaveBeenCalledWith('test-org')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'supported scan file types',
    })
    expect(result.ok).toBe(true)
    expect(result.data?.supportedFiles).toContain('package.json')
  })

  it('handles SDK setup failure', async () => {
    const { fetchSupportedScanFileNames } =
      await import('../../../../../src/commands/scan/fetch-supported-scan-file-names.mts')

    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid configuration',
    })

    const result = await fetchSupportedScanFileNames()

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Failed to setup SDK')
    expect(result.cause).toBe('Invalid configuration')
  })

  it('handles API call failure', async () => {
    const { fetchSupportedScanFileNames } =
      await import('../../../../../src/commands/scan/fetch-supported-scan-file-names.mts')

    await setupSdkMockError('getSupportedFiles', 'API error', 500)
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'test-org' })

    const result = await fetchSupportedScanFileNames()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('handles org slug failure', async () => {
    const { fetchSupportedScanFileNames } =
      await import('../../../../../src/commands/scan/fetch-supported-scan-file-names.mts')

    await setupSdkMockSuccess('getSupportedFiles', {})
    mockGetDefaultOrgSlug.mockResolvedValue({
      ok: false,
      message: 'No org found',
    })

    const result = await fetchSupportedScanFileNames()

    expect(result.ok).toBe(false)
  })

  it('passes custom SDK options', async () => {
    const { fetchSupportedScanFileNames } =
      await import('../../../../../src/commands/scan/fetch-supported-scan-file-names.mts')

    const { mockSdk, mockSetupSdk } = await setupSdkMockSuccess(
      'getSupportedFiles',
      {},
    )
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'my-org' })

    const options = {
      sdkOpts: {
        apiToken: 'custom-token',
        baseUrl: 'https://api.example.com',
      },
    }

    await fetchSupportedScanFileNames(options)

    expect(mockSetupSdk).toHaveBeenCalledWith(options.sdkOpts)
    expect(mockSdk.getSupportedFiles).toHaveBeenCalledWith('my-org')
  })

  it('passes custom spinner', async () => {
    const { fetchSupportedScanFileNames } =
      await import('../../../../../src/commands/scan/fetch-supported-scan-file-names.mts')

    const { mockHandleApi } = await setupSdkMockSuccess(
      'getSupportedFiles',
      {},
    )
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'test-org' })

    const mockSpinner = {
      start: vi.fn(),
      stop: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    }

    await fetchSupportedScanFileNames({ spinner: mockSpinner })

    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'supported scan file types',
      spinner: mockSpinner,
    })
  })

  it('handles empty supported files response', async () => {
    const { fetchSupportedScanFileNames } =
      await import('../../../../../src/commands/scan/fetch-supported-scan-file-names.mts')

    await setupSdkMockSuccess('getSupportedFiles', {
      supportedFiles: [],
      ecosystems: [],
    })
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'test-org' })

    const result = await fetchSupportedScanFileNames()

    expect(result.ok).toBe(true)
    expect(result.data?.supportedFiles).toEqual([])
    expect(result.data?.ecosystems).toEqual([])
  })

  it('works without options parameter', async () => {
    const { fetchSupportedScanFileNames } =
      await import('../../../../../src/commands/scan/fetch-supported-scan-file-names.mts')

    const { mockHandleApi, mockSetupSdk } = await setupSdkMockSuccess(
      'getSupportedFiles',
      { supportedFiles: ['package.json'] },
    )
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'test-org' })

    const result = await fetchSupportedScanFileNames()

    expect(mockSetupSdk).toHaveBeenCalledWith(undefined)
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'supported scan file types',
      spinner: undefined,
    })
    expect(result.ok).toBe(true)
  })

  it('uses null prototype for options', async () => {
    const { fetchSupportedScanFileNames } =
      await import('../../../../../src/commands/scan/fetch-supported-scan-file-names.mts')

    const { mockSdk } = await setupSdkMockSuccess('getSupportedFiles', {})
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'test-org' })

    await fetchSupportedScanFileNames()

    expect(mockSdk.getSupportedFiles).toHaveBeenCalled()
  })
})
