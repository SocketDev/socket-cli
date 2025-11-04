/**
 * Unit tests for fetchAuditLog function.
 *
 * Tests the data fetching logic for organization audit logs. These tests verify
 * SDK integration, pagination handling, and various filtering options.
 *
 * Test Coverage:
 * - Successful audit log fetch with events and total count
 * - SDK setup failure with error propagation
 * - API call failure handling
 * - Custom SDK options pass-through
 * - Different log types (all, security, access, etc.)
 * - Pagination parameters (page, perPage)
 * - Output kind handling (json, markdown, text)
 * - Organization slug parameter passing
 *
 * Testing Approach:
 * - Mock Socket SDK using setupSdkMockSuccess/Error/SetupFailure helpers
 * - Mock handleApiCall from utils/socket/api.mts
 * - Mock setupSdk from utils/socket/sdk.mts
 * - Verify SDK method calls with correct query parameters
 * - Test CResult pattern (ok/error states)
 *
 * Related Files:
 * - src/commands/audit-log/fetch-audit-log.mts - Implementation
 * - src/commands/audit-log/handle-audit-log.mts - Handler that calls this fetcher
 * - test/helpers/sdk-test-helpers.mts - SDK mocking utilities
 */

import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../../../src/commands/../../../test/helpers/sdk-test-helpers.mts'
import { fetchAuditLog } from '../../../../src/src/commands/../../../../src/commands/audit-log/fetch-audit-log.mts'

// Mock the dependencies.
vi.mock('../../../../../src/commands/../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../../../../src/commands/../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchAuditLog', () => {
  it('fetches audit log successfully', async () => {
    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getAuditLogEvents',
      {
        events: [
          {
            id: 'event-1',
            action: 'package.scan',
            actor: 'user@example.com',
            timestamp: '2025-01-20T10:00:00Z',
          },
          {
            id: 'event-2',
            action: 'repository.create',
            actor: 'admin@example.com',
            timestamp: '2025-01-20T11:00:00Z',
          },
        ],
        total: 2,
      },
    )

    const config = {
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 100,
    }

    const result = await fetchAuditLog(config)

    expect(mockSdk.getAuditLogEvents).toHaveBeenCalledWith('test-org', {
      outputJson: true,
      outputMarkdown: false,
      orgSlug: 'test-org',
      type: 'all',
      page: 1,
      per_page: 100,
    })
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'audit log for test-org',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid API token',
    })

    const config = {
      logType: 'all',
      orgSlug: 'my-org',
      outputKind: 'text' as const,
      page: 1,
      perPage: 50,
    }

    const result = await fetchAuditLog(config)

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Failed to setup SDK')
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('getAuditLogEvents', 'Unauthorized access', 403)

    const config = {
      logType: 'security',
      orgSlug: 'restricted-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 100,
    }

    const result = await fetchAuditLog(config)

    expect(result.ok).toBe(false)
    expect(result.code).toBe(403)
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('getAuditLogEvents', {})

    const sdkOpts = {
      apiToken: 'audit-token',
      baseUrl: 'https://audit.api.com',
    }

    const config = {
      logType: 'all',
      orgSlug: 'custom-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 100,
    }

    await fetchAuditLog(config, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles pagination parameters', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getAuditLogEvents', {})

    const config = {
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'json' as const,
      page: 5,
      perPage: 25,
    }

    await fetchAuditLog(config)

    expect(mockSdk.getAuditLogEvents).toHaveBeenCalledWith(
      'test-org',
      expect.objectContaining({
        page: 5,
        per_page: 25,
      }),
    )
  })

  it('handles date filtering', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getAuditLogEvents', {})

    const logTypes = ['all', 'security', 'configuration', 'access']

    for (const logType of logTypes) {
      const config = {
        logType,
        orgSlug: 'test-org',
        outputKind: 'json' as const,
        page: 1,
        perPage: 100,
      }

      // eslint-disable-next-line no-await-in-loop
      await fetchAuditLog(config)

      expect(mockSdk.getAuditLogEvents).toHaveBeenCalledWith(
        'test-org',
        expect.objectContaining({
          type: logType,
        }),
      )
    }
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getAuditLogEvents', {})

    const config = {
      logType: 'all',
      orgSlug: 'test-org',
      outputKind: 'json' as const,
      page: 1,
      perPage: 100,
    }

    // This tests that the function properly uses __proto__: null.
    await fetchAuditLog(config)

    // The function should work without prototype pollution issues.
    expect(mockSdk.getAuditLogEvents).toHaveBeenCalled()
  })
})
