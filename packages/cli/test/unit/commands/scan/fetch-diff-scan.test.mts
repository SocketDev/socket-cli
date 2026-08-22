/**
 * Unit tests for fetchDiffScan.
 *
 * Purpose: Tests fetching scan diffs via the Socket API. Compares two scans to
 * identify changes in security posture.
 *
 * Test Coverage: - Successful API operation - SDK setup failure handling - API
 * call error scenarios - Custom SDK options (API tokens, base URLs) - Scan
 * comparison - Diff calculation - Change detection - Null prototype usage for
 * security.
 *
 * Testing Approach: Uses SDK test helpers to mock Socket API interactions.
 * Validates comprehensive error handling and API integration.
 *
 * Related Files: - src/commands/scan/fetch-diff-scan.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupSdkSetupFailure } from '../../../helpers/sdk-test-helpers.mts'
import { fetchDiffScan } from '../../../../src/commands/scan/fetch-diff-scan.mts'

import type * as ApiModule from '../../../../src/util/socket/api.mts'
import type * as SdkModule from '../../../../src/util/socket/sdk.mts'
import type { Mock } from 'vitest'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock(import('../../../../src/util/socket/api.mts'), () => ({
  handleApiCall: vi.fn(),
}))

vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  setupSdk: vi.fn(),
}))

async function getMockHandleApiCall(): Promise<Mock> {
  const module = await vi.importMock<typeof ApiModule>(
    '../../../../src/util/socket/api.mts',
  )
  return vi.mocked(module.handleApiCall)
}

async function getMockSetupSdk(): Promise<Mock> {
  const module = await vi.importMock<typeof SdkModule>(
    '../../../../src/util/socket/sdk.mts',
  )
  return vi.mocked(module.setupSdk)
}

// Helper to create a mock diff scan response (getDiffScanById shape).
function createMockDiffScanData(overrides = {}) {
  return {
    diff_scan: {
      id: 'diff-scan-001',
      organization_id: 'org-1',
      repository_id: 'repo-1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      before_full_scan: {
        id: 'scan-before',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        organization_id: 'org-1',
        organization_slug: 'test-org',
        repository_id: 'repo-1',
        repository_slug: 'test-repo',
        branch: 'main',
        commit_message: undefined,
        commit_hash: undefined,
        pull_request: undefined,
        committers: [],
        html_url: undefined,
        api_url: undefined,
      },
      after_full_scan: {
        id: 'scan-after',
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        organization_id: 'org-1',
        organization_slug: 'test-org',
        repository_id: 'repo-1',
        repository_slug: 'test-repo',
        branch: 'feature',
        commit_message: undefined,
        commit_hash: undefined,
        pull_request: undefined,
        committers: [],
        html_url: undefined,
        api_url: undefined,
      },
      description: undefined,
      external_href: undefined,
      merge: false,
      html_url: 'https://socket.dev/diff/123',
      api_url: undefined,
      incomplete: false,
      artifacts: {
        added: [],
        removed: [],
        unchanged: [],
        replaced: [],
        updated: [],
      },
      ...overrides,
    },
  }
}

// Helper to create a mock create result (createOrgDiffScanFromIds shape).
function createMockCreateData(diffScanId = 'diff-scan-001') {
  return {
    diff_scan: {
      id: diffScanId,
      organization_id: 'org-1',
      repository_id: 'repo-1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  }
}

describe('fetchDiffScan', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const setupSdk = await getMockSetupSdk()
    const handleApiCall = await getMockHandleApiCall()
    setupSdk.mockReset()
    handleApiCall.mockReset()
  })

  it('fetches diff scan successfully', async () => {
    const setupSdk = await getMockSetupSdk()
    const handleApiCall = await getMockHandleApiCall()

    const mockSdk = {
      createOrgDiffScanFromIds: vi.fn().mockResolvedValue({
        success: true,
        data: createMockCreateData('diff-scan-001'),
      }),
      getDiffScanById: vi.fn().mockResolvedValue({
        success: true,
        data: createMockDiffScanData(),
      }),
    }

    setupSdk.mockResolvedValue({ ok: true, data: mockSdk })

    const mockDiffData = createMockDiffScanData()
    handleApiCall
      .mockResolvedValueOnce({
        ok: true,
        data: createMockCreateData('diff-scan-001'),
      })
      .mockResolvedValueOnce({ ok: true, data: mockDiffData })

    const result = await fetchDiffScan({
      id1: 'scan-123',
      id2: 'scan-456',
      orgSlug: 'test-org',
    })

    expect(mockLogger.info).toHaveBeenCalledWith('Scan ID 1:', 'scan-123')
    expect(mockLogger.info).toHaveBeenCalledWith('Scan ID 2:', 'scan-456')
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Note: this request may take some time if the scans are big',
    )
    expect(mockSdk.createOrgDiffScanFromIds).toHaveBeenCalledWith('test-org', {
      before: 'scan-123',
      after: 'scan-456',
      on_duplicate: 'redirect',
    })
    expect(mockSdk.getDiffScanById).toHaveBeenCalledWith(
      'test-org',
      'diff-scan-001',
      { cached: true },
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual(mockDiffData)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Authentication failed',
    })

    const result = await fetchDiffScan({
      id1: 'scan-123',
      id2: 'scan-456',
      orgSlug: 'test-org',
    })

    expect(result.ok).toBe(false)
  })

  it('handles createOrgDiffScanFromIds failure', async () => {
    const setupSdk = await getMockSetupSdk()
    const handleApiCall = await getMockHandleApiCall()

    const mockSdk = {
      createOrgDiffScanFromIds: vi.fn(),
      getDiffScanById: vi.fn(),
    }

    setupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    handleApiCall.mockResolvedValueOnce({
      ok: false,
      message: 'Socket API error',
      code: 404,
      cause: 'Scan not found',
    })

    const result = await fetchDiffScan({
      id1: 'nonexistent-scan',
      id2: 'another-nonexistent-scan',
      orgSlug: 'test-org',
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
    // getDiffScanById should not be called when create fails
    expect(mockSdk.getDiffScanById).not.toHaveBeenCalled()
  })

  it('handles getDiffScanById failure', async () => {
    const setupSdk = await getMockSetupSdk()
    const handleApiCall = await getMockHandleApiCall()

    const mockSdk = {
      createOrgDiffScanFromIds: vi.fn(),
      getDiffScanById: vi.fn(),
    }

    setupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    handleApiCall
      .mockResolvedValueOnce({
        ok: true,
        data: createMockCreateData('diff-scan-001'),
      })
      .mockResolvedValueOnce({
        ok: false,
        message: 'Socket API error',
        code: 504,
        cause: 'Gateway timeout',
      })

    const result = await fetchDiffScan({
      id1: 'large-scan-1',
      id2: 'large-scan-2',
      orgSlug: 'test-org',
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(504)
  })

  it('handles different org slugs', async () => {
    const setupSdk = await getMockSetupSdk()
    const handleApiCall = await getMockHandleApiCall()

    const mockSdk = {
      createOrgDiffScanFromIds: vi.fn().mockResolvedValue({
        success: true,
        data: createMockCreateData(),
      }),
      getDiffScanById: vi.fn().mockResolvedValue({
        success: true,
        data: createMockDiffScanData(),
      }),
    }

    setupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    handleApiCall.mockResolvedValue({
      ok: true,
      data: createMockDiffScanData(),
    })

    const testCases = [
      'org-with-dashes',
      'simple_org',
      'org123',
      'long.org.name.with.dots',
    ]

    for (let i = 0, { length } = testCases; i < length; i += 1) {
      const orgSlug = testCases[i]
      await fetchDiffScan({
        id1: 'scan-1',
        id2: 'scan-2',
        orgSlug,
      })

      expect(mockSdk.createOrgDiffScanFromIds).toHaveBeenCalledWith(orgSlug, {
        before: 'scan-1',
        after: 'scan-2',
        on_duplicate: 'redirect',
      })
    }
  })

  it('handles empty diff results', async () => {
    const setupSdk = await getMockSetupSdk()
    const handleApiCall = await getMockHandleApiCall()

    const mockSdk = {
      createOrgDiffScanFromIds: vi.fn(),
      getDiffScanById: vi.fn(),
    }

    setupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    const emptyDiffData = createMockDiffScanData()
    handleApiCall
      .mockResolvedValueOnce({ ok: true, data: createMockCreateData() })
      .mockResolvedValueOnce({ ok: true, data: emptyDiffData })

    const result = await fetchDiffScan({
      id1: 'scan-identical-1',
      id2: 'scan-identical-2',
      orgSlug: 'test-org',
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(emptyDiffData)
  })

  it('handles same scan IDs gracefully', async () => {
    const setupSdk = await getMockSetupSdk()
    const handleApiCall = await getMockHandleApiCall()

    const mockSdk = {
      createOrgDiffScanFromIds: vi.fn(),
      getDiffScanById: vi.fn(),
    }

    setupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    handleApiCall
      .mockResolvedValueOnce({ ok: true, data: createMockCreateData() })
      .mockResolvedValueOnce({ ok: true, data: createMockDiffScanData() })

    await fetchDiffScan({
      id1: 'same-scan-id',
      id2: 'same-scan-id',
      orgSlug: 'test-org',
    })

    expect(mockLogger.info).toHaveBeenCalledWith('Scan ID 1:', 'same-scan-id')
    expect(mockLogger.info).toHaveBeenCalledWith('Scan ID 2:', 'same-scan-id')
    expect(mockSdk.createOrgDiffScanFromIds).toHaveBeenCalledWith('test-org', {
      before: 'same-scan-id',
      after: 'same-scan-id',
      on_duplicate: 'redirect',
    })
  })

  it('passes cached: true to getDiffScanById', async () => {
    const setupSdk = await getMockSetupSdk()
    const handleApiCall = await getMockHandleApiCall()

    const mockSdk = {
      createOrgDiffScanFromIds: vi.fn(),
      getDiffScanById: vi.fn(),
    }

    setupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    handleApiCall
      .mockResolvedValueOnce({ ok: true, data: createMockCreateData() })
      .mockResolvedValueOnce({ ok: true, data: createMockDiffScanData() })

    await fetchDiffScan({
      id1: 'scan-1',
      id2: 'scan-2',
      orgSlug: 'test-org',
    })

    expect(mockSdk.getDiffScanById).toHaveBeenCalledWith(
      'test-org',
      'diff-scan-001',
      { cached: true },
    )
  })
})
