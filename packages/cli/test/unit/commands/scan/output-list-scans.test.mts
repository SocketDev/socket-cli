/**
 * Unit tests for outputListScans.
 *
 * Purpose:
 * Tests output formatting for scan list operations.
 * Validates table formatting and JSON serialization.
 *
 * Test Coverage:
 * - Successful scan list output formatting
 * - Error message formatting
 * - JSON output mode
 * - Text output with table formatting
 * - Empty results handling
 * - Exit code setting
 *
 * Testing Approach:
 * Uses mocked logger to capture output.
 * Tests different output modes and edge cases.
 *
 * Related Files:
 * - src/commands/scan/output-list-scans.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

// Mock failMsgWithBadge.
const mockFailMsgWithBadge = vi.hoisted(() =>
  vi.fn((msg, cause) => `${msg}: ${cause}`),
)
vi.mock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: mockFailMsgWithBadge,
}))

// Mock serializeResultJson.
const mockSerializeResultJson = vi.hoisted(() =>
  vi.fn(result => JSON.stringify(result)),
)
vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: mockSerializeResultJson,
}))

// Mock chalk-table.
const mockChalkTable = vi.hoisted(() => vi.fn(() => 'mocked-table-output'))
vi.mock('chalk-table', () => ({
  default: mockChalkTable,
}))

import { outputListScans } from '../../../../src/commands/scan/output-list-scans.mts'

import type { CResult } from '../../../../src/types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Helper to create success result.
function createSuccessResult<T>(data: T): CResult<T> {
  return { ok: true, data }
}

// Helper to create error result.
function createErrorResult(
  message: string,
  options: { code?: number; cause?: string } = {},
): CResult<never> {
  return { ok: false, message, ...options }
}

describe('outputListScans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('JSON output mode', () => {
    it('outputs JSON for successful result', async () => {
      const mockData = {
        results: [
          {
            id: 'scan-123',
            html_report_url: 'https://socket.dev/scans/123',
            created_at: '2024-01-15T10:00:00Z',
            repo: 'my-repo',
            branch: 'main',
          },
        ],
      }

      const result = createSuccessResult(mockData)

      await outputListScans(result as any, 'json')

      expect(mockSerializeResultJson).toHaveBeenCalledWith(result)
      expect(mockLogger.log).toHaveBeenCalled()
      expect(process.exitCode).toBeUndefined()
    })

    it('outputs JSON for error result', async () => {
      const result = createErrorResult('Failed to list scans', {
        code: 500,
        cause: 'Server error',
      })

      await outputListScans(result as any, 'json')

      expect(mockSerializeResultJson).toHaveBeenCalledWith(result)
      expect(mockLogger.log).toHaveBeenCalled()
      expect(process.exitCode).toBe(500)
    })
  })

  describe('text output mode', () => {
    it('outputs formatted table for successful result', async () => {
      const mockData = {
        results: [
          {
            id: 'scan-123',
            html_report_url: 'https://socket.dev/scans/123',
            created_at: '2024-01-15T10:00:00Z',
            repo: 'my-repo',
            branch: 'main',
          },
          {
            id: 'scan-456',
            html_report_url: 'https://socket.dev/scans/456',
            created_at: '2024-01-14T10:00:00Z',
            repo: 'other-repo',
            branch: 'feature',
          },
        ],
      }

      const result = createSuccessResult(mockData)

      await outputListScans(result as any, 'text')

      expect(mockChalkTable).toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith('mocked-table-output')
      expect(process.exitCode).toBeUndefined()
    })

    it('outputs error message for failed result', async () => {
      const result = createErrorResult('Failed to list scans', {
        code: 1,
        cause: 'Network error',
      })

      await outputListScans(result as any, 'text')

      expect(mockFailMsgWithBadge).toHaveBeenCalledWith(
        'Failed to list scans',
        'Network error',
      )
      expect(mockLogger.fail).toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    })

    it('handles empty results array', async () => {
      const mockData = {
        results: [],
      }

      const result = createSuccessResult(mockData)

      await outputListScans(result as any, 'text')

      expect(mockChalkTable).toHaveBeenCalled()
      expect(process.exitCode).toBeUndefined()
    })

    it('handles null created_at', async () => {
      const mockData = {
        results: [
          {
            id: 'scan-789',
            html_report_url: 'https://socket.dev/scans/789',
            created_at: null,
            repo: 'my-repo',
            branch: 'main',
          },
        ],
      }

      const result = createSuccessResult(mockData)

      await outputListScans(result as any, 'text')

      expect(mockChalkTable).toHaveBeenCalledWith(
        expect.any(Object),
        expect.arrayContaining([
          expect.objectContaining({
            id: 'scan-789',
            created_at: '',
          }),
        ]),
      )
    })
  })

  describe('exit code handling', () => {
    it('sets exit code from error result', async () => {
      const result = createErrorResult('Error', { code: 42 })

      await outputListScans(result as any, 'text')

      expect(process.exitCode).toBe(42)
    })

    it('sets exit code to 1 when code is undefined', async () => {
      const result = {
        ok: false,
        message: 'Error without code',
      }

      await outputListScans(result as any, 'text')

      expect(process.exitCode).toBe(1)
    })

    it('does not set exit code for successful result', async () => {
      const result = createSuccessResult({ results: [] })

      await outputListScans(result as any, 'text')

      expect(process.exitCode).toBeUndefined()
    })
  })
})
