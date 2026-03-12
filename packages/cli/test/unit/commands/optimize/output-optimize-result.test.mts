/**
 * Unit tests for optimize result output.
 *
 * Purpose:
 * Tests the outputOptimizeResult function for different output formats.
 *
 * Test Coverage:
 * - JSON output format
 * - Markdown output format
 * - Text output format
 * - Error handling
 *
 * Related Files:
 * - commands/optimize/output-optimize-result.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

vi.mock('@socketsecurity/lib/words', () => ({
  pluralize: (word: string, options: { count: number }) =>
    options.count === 1 ? word : `${word}s`,
}))

vi.mock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: (message: string, cause?: string) =>
    cause ? `${message}: ${cause}` : message,
}))

vi.mock('../../../../src/utils/output/markdown.mts', () => ({
  mdError: (message: string, cause?: string) =>
    cause ? `## Error\n${message}: ${cause}` : `## Error\n${message}`,
  mdHeader: (title: string) => `# ${title}`,
  mdList: (items: string[]) => items.map(i => `- ${i}`).join('\n'),
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: any) => JSON.stringify(result),
}))

import { outputOptimizeResult } from '../../../../src/commands/optimize/output-optimize-result.mts'

describe('output-optimize-result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })

  describe('outputOptimizeResult', () => {
    it('outputs JSON for successful result', async () => {
      const result = {
        ok: true as const,
        data: {
          addedCount: 2,
          updatedCount: 1,
          pkgJsonChanged: true,
          updatedInWorkspaces: 0,
          addedInWorkspaces: 0,
        },
      }

      await outputOptimizeResult(result, 'json')

      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('"ok":true'))
    })

    it('outputs JSON for error result', async () => {
      const result = {
        ok: false as const,
        message: 'Something went wrong',
        code: 1,
      }

      await outputOptimizeResult(result, 'json')

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('"ok":false'),
      )
      expect(process.exitCode).toBe(1)
    })

    it('outputs markdown for successful result with changes', async () => {
      const result = {
        ok: true as const,
        data: {
          addedCount: 3,
          updatedCount: 2,
          pkgJsonChanged: true,
          updatedInWorkspaces: 1,
          addedInWorkspaces: 2,
        },
      }

      await outputOptimizeResult(result, 'markdown')

      expect(mockLogger.log).toHaveBeenCalledWith('# Optimize Complete')
    })

    it('outputs markdown for successful result without changes', async () => {
      const result = {
        ok: true as const,
        data: {
          addedCount: 0,
          updatedCount: 0,
          pkgJsonChanged: false,
          updatedInWorkspaces: 0,
          addedInWorkspaces: 0,
        },
      }

      await outputOptimizeResult(result, 'markdown')

      expect(mockLogger.log).toHaveBeenCalledWith(
        'No Socket.dev optimized overrides applied.',
      )
    })

    it('outputs markdown error for failed result', async () => {
      const result = {
        ok: false as const,
        message: 'Failed to optimize',
        cause: 'Network error',
        code: 1,
      }

      await outputOptimizeResult(result, 'markdown')

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Error'),
      )
    })

    it('outputs text for successful result with updates', async () => {
      const result = {
        ok: true as const,
        data: {
          addedCount: 0,
          updatedCount: 3,
          pkgJsonChanged: true,
          updatedInWorkspaces: 2,
          addedInWorkspaces: 0,
        },
      }

      await outputOptimizeResult(result, 'text')

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Updated'),
      )
      expect(mockLogger.success).toHaveBeenCalledWith('Finished!')
    })

    it('outputs text for successful result with additions', async () => {
      const result = {
        ok: true as const,
        data: {
          addedCount: 5,
          updatedCount: 0,
          pkgJsonChanged: true,
          updatedInWorkspaces: 0,
          addedInWorkspaces: 3,
        },
      }

      await outputOptimizeResult(result, 'text')

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Added'),
      )
    })

    it('outputs text for no changes', async () => {
      const result = {
        ok: true as const,
        data: {
          addedCount: 0,
          updatedCount: 0,
          pkgJsonChanged: false,
          updatedInWorkspaces: 0,
          addedInWorkspaces: 0,
        },
      }

      await outputOptimizeResult(result, 'text')

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Scan complete. No Socket.dev optimized overrides applied.',
      )
    })

    it('outputs text error for failed result', async () => {
      const result = {
        ok: false as const,
        message: 'Optimization failed',
        code: 1,
      }

      await outputOptimizeResult(result, 'text')

      expect(mockLogger.fail).toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    })
  })
})
