/**
 * Unit tests for outputDiffScan markdown output mode.
 *
 * Purpose: Tests output formatting for scan diff operations. Validates
 * markdown output mode.
 *
 * Test Coverage: - Markdown output formatting.
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
function createSuccessResult<T>(data: T): CResult<T> {
  return { ok: true, data }
}

describe('outputDiffScan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockWriteFile.mockResolvedValue(undefined)
  })

  describe('markdown output mode', () => {
    it('outputs markdown header', async () => {
      const mockData = createMockDiffData()
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Scan diff result'),
      )
    })

    it('outputs added packages', async () => {
      const mockData = createMockDiffData({
        artifacts: {
          added: [
            { type: 'npm', name: 'lodash', version: '4.17.21' },
            { type: 'npm', name: 'express', version: '4.18.0' },
          ],
          removed: [],
          replaced: [],
          updated: [],
          unchanged: [],
        },
      })
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith('- Added packages: 2')
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('lodash@4.17.21'),
      )
    })

    it('outputs removed packages', async () => {
      const mockData = createMockDiffData({
        artifacts: {
          added: [],
          removed: [{ type: 'npm', name: 'old-package', version: '1.0.0' }],
          replaced: [],
          updated: [],
          unchanged: [],
        },
      })
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith('- Removed packages: 1')
    })

    it('truncates removed package list when over 10', async () => {
      const removedMany = Array.from({ length: 12 }, (_, i) => ({
        type: 'npm',
        name: `removed-${i}`,
        version: '1.0.0',
      }))
      const mockData = createMockDiffData({
        artifacts: {
          added: [],
          removed: removedMany,
          replaced: [],
          updated: [],
          unchanged: [],
        },
      })
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith('- Removed packages: 12')
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('and 2 more'),
      )
    })

    it('truncates package lists longer than 10', async () => {
      const manyPackages = Array.from({ length: 15 }, (_, i) => ({
        type: 'npm',
        name: `package-${i}`,
        version: '1.0.0',
      }))
      const mockData = createMockDiffData({
        artifacts: {
          added: manyPackages,
          removed: [],
          replaced: [],
          updated: [],
          unchanged: [],
        },
      })
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('and 5 more'),
      )
    })

    it('outputs unchanged packages', async () => {
      const mockData = createMockDiffData({
        artifacts: {
          added: [],
          removed: [],
          replaced: [],
          updated: [],
          unchanged: [{ type: 'npm', name: 'stable-pkg', version: '1.0.0' }],
        },
      })
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith('- Unchanged packages: 1')
    })

    it('outputs replaced packages with truncation', async () => {
      const replacedMany = Array.from({ length: 12 }, (_, i) => ({
        type: 'npm',
        name: `pkg-replaced-${i}`,
        version: '2.0.0',
      }))
      const mockData = createMockDiffData({
        artifacts: {
          added: [],
          removed: [],
          replaced: replacedMany,
          updated: [],
          unchanged: [],
        },
      })
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith('- Replaced packages: 12')
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('and 2 more'),
      )
    })

    it('outputs updated packages with truncation', async () => {
      const updatedMany = Array.from({ length: 12 }, (_, i) => ({
        type: 'npm',
        name: `pkg-updated-${i}`,
        version: '3.0.0',
      }))
      const mockData = createMockDiffData({
        artifacts: {
          added: [],
          removed: [],
          replaced: [],
          updated: updatedMany,
          unchanged: [],
        },
      })
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith('- Updated packages: 12')
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('and 2 more'),
      )
    })

    it('truncates unchanged packages list when over 10', async () => {
      const unchangedMany = Array.from({ length: 12 }, (_, i) => ({
        type: 'npm',
        name: `unchanged-${i}`,
        version: '1.0.0',
      }))
      const mockData = createMockDiffData({
        artifacts: {
          added: [],
          removed: [],
          replaced: [],
          updated: [],
          unchanged: unchangedMany,
        },
      })
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith('- Unchanged packages: 12')
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('and 2 more'),
      )
    })

    it('handles null unchanged array', async () => {
      const mockData = createMockDiffData({
        artifacts: {
          added: [],
          removed: [],
          replaced: [],
          updated: [],
          unchanged: undefined,
        },
      })
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith('- Unchanged packages: 0')
    })

    it('outputs scan metadata', async () => {
      const mockData = createMockDiffData()
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Scan scan-before'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Scan scan-after'),
      )
    })

    it('skips null pull_request in output', async () => {
      const mockData = createMockDiffData()
      const result = createSuccessResult(mockData)

      await outputDiffScan(result as unknown, {
        depth: 5,
        file: '',
        outputKind: 'markdown',
      })

      // Should not output pull_request line when null.
      const calls = mockLogger.group.mock.calls.flat()
      const hasPullRequest = calls.some(
        call => typeof call === 'string' && call.includes('pull_request'),
      )
      expect(hasPullRequest).toBe(false)
    })
  })
})
