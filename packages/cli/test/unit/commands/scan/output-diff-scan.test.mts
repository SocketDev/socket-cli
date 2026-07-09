/**
 * Unit tests for outputDiffScan.
 *
 * Purpose: Tests output formatting for scan diff operations. Validates JSON,
 * markdown, and text output modes.
 *
 * Test Coverage: - JSON output mode with file writing - Markdown output
 * formatting - Text output with inspect - Error handling - File write
 * operations - Exit code setting.
 *
 * Testing Approach: Uses mocked logger and fs to capture output. Tests
 * different output modes and edge cases.
 *
 * Related Files: - src/commands/scan/output-diff-scan.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CResult } from '../../../../src/types.mts'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

// Mock failMsgWithBadge.
const mockFailMsgWithBadge = vi.hoisted(() =>
  vi.fn((msg, cause) => `${msg}: ${cause}`),
)
vi.mock(import('../../../../src/util/error/fail-msg-with-badge.mts'), () => ({
  failMsgWithBadge: mockFailMsgWithBadge,
}))

// Mock serializeResultJson.
const mockSerializeResultJson = vi.hoisted(() =>
  vi.fn(result => JSON.stringify(result)),
)
vi.mock(import('../../../../src/util/output/result-json.mjs'), () => ({
  serializeResultJson: mockSerializeResultJson,
}))

// Mock markdown utilities.
vi.mock(import('../../../../src/util/output/markdown.mts'), () => ({
  mdHeader: vi.fn((text, level = 1) => `${'#'.repeat(level)} ${text}`),
}))

// Mock terminal link.
vi.mock(import('../../../../src/util/terminal/link.mts'), () => ({
  fileLink: vi.fn(path => path),
}))

// Mock fs.
const mockWriteFile = vi.hoisted(() => vi.fn())
vi.mock(import('node:fs'), () => ({
  promises: {
    writeFile: mockWriteFile,
  },
}))

import { outputDiffScan } from '../../../../src/commands/scan/output-diff-scan.mts'

// Helper to create error result.
export function createErrorResult(
  message: string,
  options: { code?: number | undefined; cause?: string | undefined } = {},
): CResult<never> {
  return { ok: false, message, ...options }
}

// Helper to create mock diff scan data.
function createMockDiffData(overrides = {}) {
  return {
    diff_report_url: 'https://socket.dev/diff/123',
    directDependenciesChanged: true,
    before: {
      id: 'scan-before',
      organization_id: 'org-1',
      organization_slug: 'test-org',
      repository_id: 'repo-1',
      repository_slug: 'test-repo',
      branch: 'main',
      created_at: '2024-01-01T00:00:00Z',
      pull_request: undefined,
    },
    after: {
      id: 'scan-after',
      organization_id: 'org-1',
      organization_slug: 'test-org',
      repository_id: 'repo-1',
      repository_slug: 'test-repo',
      branch: 'feature',
      created_at: '2024-01-02T00:00:00Z',
      pull_request: undefined,
    },
    artifacts: {
      added: [],
      removed: [],
      replaced: [],
      updated: [],
      unchanged: [],
    },
    ...overrides,
  }
}

// Helper to create success result.
export function createSuccessResult<T>(data: T): CResult<T> {
  return { ok: true, data }
}

describe('outputDiffScan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockWriteFile.mockResolvedValue(undefined)
  })

  describe('error handling', () => {
    it('sets exit code for error result', async () => {
      const result = createErrorResult('Diff scan failed', {
        code: 500,
        cause: 'Server error',
      })

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'text',
      })

      expect(process.exitCode).toBe(500)
    })

    it('outputs error in JSON mode', async () => {
      const result = createErrorResult('Diff scan failed', {
        code: 404,
        cause: 'Not found',
      })

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'json',
      })

      expect(mockLogger.log).toHaveBeenCalled()
      expect(process.exitCode).toBe(404)
    })

    it('outputs error in text mode', async () => {
      const result = createErrorResult('Diff scan failed', {
        code: 1,
        cause: 'Network error',
      })

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'text',
      })

      expect(mockLogger.fail).toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    })

    it('defaults exit code to 1 when code is undefined', async () => {
      const result = {
        ok: false,
        message: 'Error without code',
      }

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'text',
      })

      expect(process.exitCode).toBe(1)
    })
  })

  describe('JSON output mode', () => {
    it('outputs JSON to stdout', async () => {
      const mockData = createMockDiffData()
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'json',
      })

      expect(mockLogger.log).toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Diff scan result'),
      )
    })

    it('outputs JSON to stdout with dash file', async () => {
      const mockData = createMockDiffData()
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '-',
        outputKind: 'json',
      })

      expect(mockLogger.log).toHaveBeenCalled()
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('writes JSON to file', async () => {
      const mockData = createMockDiffData()
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: 'output.json',
        outputKind: 'text',
      })

      expect(mockWriteFile).toHaveBeenCalledWith(
        'output.json',
        expect.any(String),
        'utf8',
      )
      expect(mockLogger.success).toHaveBeenCalled()
    })

    it('handles file write error', async () => {
      mockWriteFile.mockRejectedValue(new Error('Permission denied'))
      const mockData = createMockDiffData()
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '/invalid/path.json',
        outputKind: 'text',
      })

      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
      )
      expect(mockLogger.error).toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    })
  })

  describe('text output mode', () => {
    it('outputs inspect result', async () => {
      const mockData = createMockDiffData()
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'text',
      })

      expect(mockLogger.log).toHaveBeenCalledWith('Diff scan result:')
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('--json flag'),
      )
    })

    it('uses null depth for depth <= 0', async () => {
      const mockData = createMockDiffData()
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 0,
        file: '',
        outputKind: 'text',
      })

      expect(mockLogger.log).toHaveBeenCalled()
    })

    it('includes dashboard message', async () => {
      const mockData = createMockDiffData()
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'text',
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('socket.dev/diff/123'),
      )
    })

    it('handles missing dashboard URL', async () => {
      const mockData = createMockDiffData({ diff_report_url: undefined })
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'text',
      })

      expect(mockLogger.log).toHaveBeenCalled()
    })
  })
})
