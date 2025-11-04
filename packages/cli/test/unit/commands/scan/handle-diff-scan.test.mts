/**
 * Unit tests for handleDiffScan.
 *
 * Purpose:
 * Tests the handler that orchestrates scan diffing. Validates comparison workflow and diff output.
 *
 * Test Coverage:
 * - Successful operation flow
 * - Fetch failure handling
 * - Input validation
 * - Output formatting delegation
 * - Error propagation
 *
 * Testing Approach:
 * Mocks fetch and output functions to isolate handler orchestration logic.
 * Validates proper data flow through the handler pipeline.
 *
 * Related Files:
 * - src/commands/handleDiffScan.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../test/helpers/index.mts'

// Mock the dependencies.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

const mockFetchDiffScan = vi.hoisted(() => vi.fn())
const mockOutputDiffScan = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../../src/commands/scan/fetch-diff-scan.mts', () => ({
  fetchDiffScan: mockFetchDiffScan,
}))

vi.mock('../../../../src/commands/scan/output-diff-scan.mts', () => ({
  outputDiffScan: mockOutputDiffScan,
}))

const { handleDiffScan } = await import('../../../../src/commands/scan/handle-diff-scan.mts')

describe('handleDiffScan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and outputs scan diff successfully', async () => {
    const mockFetch = mockFetchDiffScan
    const mockOutput = mockOutputDiffScan

    const mockDiff = createSuccessResult({
      added: [{ name: 'new-package', version: '1.0.0' }],
      removed: [{ name: 'old-package', version: '0.9.0' }],
      changed: [
        {
          name: 'updated-package',
          oldVersion: '1.0.0',
          newVersion: '2.0.0',
        },
      ],
    })
    mockFetch.mockResolvedValue(mockDiff)

    await handleDiffScan({
      depth: 10,
      file: 'diff-report.json',
      id1: 'scan-123',
      id2: 'scan-456',
      orgSlug: 'test-org',
      outputKind: 'json',
    })

    expect(mockFetch).toHaveBeenCalledWith({
      id1: 'scan-123',
      id2: 'scan-456',
      orgSlug: 'test-org',
    })
    expect(mockOutput).toHaveBeenCalledWith(mockDiff, {
      depth: 10,
      file: 'diff-report.json',
      outputKind: 'json',
    })
  })

  it('handles fetch failure', async () => {
    const mockFetch = mockFetchDiffScan
    const mockOutput = mockOutputDiffScan

    const mockError = createErrorResult('Scans not found')
    mockFetch.mockResolvedValue(mockError)

    await handleDiffScan({
      depth: 5,
      file: '',
      id1: 'invalid-1',
      id2: 'invalid-2',
      orgSlug: 'test-org',
      outputKind: 'text',
    })

    expect(mockOutput).toHaveBeenCalledWith(mockError, {
      depth: 5,
      file: '',
      outputKind: 'text',
    })
  })

  it('handles markdown output format', async () => {
    const mockFetch = mockFetchDiffScan
    const mockOutput = mockOutputDiffScan

    mockFetch.mockResolvedValue(createSuccessResult({}))

    await handleDiffScan({
      depth: 3,
      file: 'output.md',
      id1: 'scan-abc',
      id2: 'scan-def',
      orgSlug: 'my-org',
      outputKind: 'markdown',
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        outputKind: 'markdown',
        file: 'output.md',
      }),
    )
  })

  it('handles different depth values', async () => {
    const mockFetch = mockFetchDiffScan
    const mockOutput = mockOutputDiffScan

    mockFetch.mockResolvedValue(createSuccessResult({}))

    const depths = [0, 1, 5, 10, 100]

    for (const depth of depths) {
      // eslint-disable-next-line no-await-in-loop
      await handleDiffScan({
        depth,
        file: '',
        id1: 'scan-1',
        id2: 'scan-2',
        orgSlug: 'test-org',
        outputKind: 'json',
      })

      expect(mockOutput).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ depth }),
      )
    }
  })

  it('handles text output without file', async () => {
    const mockFetch = mockFetchDiffScan
    const mockOutput = mockOutputDiffScan

    mockFetch.mockResolvedValue(
      createSuccessResult({
        added: [],
        removed: [],
        changed: [],
        summary: 'No changes detected',
      }),
    )

    await handleDiffScan({
      depth: 2,
      file: '',
      id1: 'scan-old',
      id2: 'scan-new',
      orgSlug: 'production-org',
      outputKind: 'text',
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          summary: 'No changes detected',
        }),
      }),
      expect.objectContaining({
        file: '',
        outputKind: 'text',
      }),
    )
  })
})
