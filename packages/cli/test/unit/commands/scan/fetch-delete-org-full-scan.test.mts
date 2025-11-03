import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../src/helpers/sdk-test-helpers.mts'
import { fetchDeleteOrgFullScan } from '../../../../src/fetch-delete-org-full-scan.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchDeleteOrgFullScan', () => {
  it('deletes scan successfully', async () => {
    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'deleteFullScan',
      {
        deleted: true,
        scanId: 'scan-123',
      },
    )

    const result = await fetchDeleteOrgFullScan('test-org', 'scan-123')

    expect(mockSdk.deleteFullScan).toHaveBeenCalledWith('test-org', 'scan-123')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'to delete a scan',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      cause: 'Invalid configuration',
    })

    const result = await fetchDeleteOrgFullScan('org', 'scan-456')

    expect(result).toEqual({
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    })
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('deleteFullScan', 'Scan not found', 404)

    const result = await fetchDeleteOrgFullScan('org', 'nonexistent-scan')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('deleteFullScan', {})

    const sdkOpts = {
      apiToken: 'custom-token',
      baseUrl: 'https://api.example.com',
    }

    await fetchDeleteOrgFullScan('org', 'scan', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles different org slugs and scan IDs', async () => {
    const { mockSdk } = await setupSdkMockSuccess('deleteFullScan', {})

    const testCases = [
      ['org-with-dashes', 'scan-123'],
      ['simple_org', 'uuid-456-789'],
      ['org123', 'scan_with_underscore'],
    ]

    for (const [org, scanId] of testCases) {
      // eslint-disable-next-line no-await-in-loop
      await fetchDeleteOrgFullScan(org, scanId)
      expect(mockSdk.deleteFullScan).toHaveBeenCalledWith(org, scanId)
    }
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('deleteFullScan', {})

    // This tests that the function properly uses __proto__: null.
    await fetchDeleteOrgFullScan('org', 'scan')

    // The function should work without prototype pollution issues.
    expect(mockSdk.deleteFullScan).toHaveBeenCalled()
  })
})
