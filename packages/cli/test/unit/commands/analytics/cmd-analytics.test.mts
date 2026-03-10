/**
 * Unit tests for analytics command.
 *
 * Tests the command that displays Socket analytics data.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag)
 * - API token requirement validation
 * - Scope arguments: org vs repo
 * - Time filter validation (7, 30, 90 days)
 * - Repository name when scope=repo
 * - Output modes: text, JSON, markdown
 * - File output flag validation
 * - Dry-run mode
 * - Legacy flag detection
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock handleAnalytics to verify handler invocation
 * - Mock hasDefaultApiToken for authentication checks
 * - Test argument combinations and defaults
 *
 * Related Files:
 * - src/commands/analytics/cmd-analytics.mts - Implementation
 * - src/commands/analytics/handle-analytics.mts - Handler
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

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock dependencies.
const mockHandleAnalytics = vi.hoisted(() => vi.fn())
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../../../src/commands/analytics/handle-analytics.mts', () => ({
  handleAnalytics: mockHandleAnalytics,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../../src/utils/socket/sdk.mjs')
    >()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

// Import after mocks.
const { cmdAnalytics } =
  await import('../../../../src/commands/analytics/cmd-analytics.mts')

describe('cmd-analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdAnalytics.description).toBe('Look up analytics data')
    })

    it('should not be hidden', () => {
      expect(cmdAnalytics.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-analytics.mts' }
    const context = { parentName: 'socket' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['--dry-run'], importMeta, context)

      expect(mockHandleAnalytics).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdAnalytics.run([], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleAnalytics).not.toHaveBeenCalled()
    })

    it('should call handleAnalytics with default values', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run([], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith({
        filepath: '',
        outputKind: 'text',
        repo: '',
        scope: 'org',
        time: 30,
      })
    })

    it('should parse "org" scope argument', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['org'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'org',
        }),
      )
    })

    it('should parse "repo" scope argument', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['repo', 'test-repo'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'repo',
          repo: 'test-repo',
        }),
      )
    })

    it('should parse time argument with org scope', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['org', '7'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'org',
          time: 7,
        }),
      )
    })

    it('should parse time argument with repo scope', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['repo', 'test-repo', '90'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'repo',
          repo: 'test-repo',
          time: 90,
        }),
      )
    })

    it('should parse standalone time argument', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['7'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'org',
          time: 7,
        }),
      )
    })

    it('should validate time is 7, 30, or 90', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['org', '15'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleAnalytics).not.toHaveBeenCalled()
    })

    it('should fail when repo scope missing repo name', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['repo'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleAnalytics).not.toHaveBeenCalled()
    })

    it('should detect time as second arg when repo scope', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['repo', '7'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure (7 is a time, not a repo name).
      expect(process.exitCode).toBe(2)
      expect(mockHandleAnalytics).not.toHaveBeenCalled()
    })

    it('should detect time as second arg with 30', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['repo', '30'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure (30 is a time, not a repo name).
      expect(process.exitCode).toBe(2)
      expect(mockHandleAnalytics).not.toHaveBeenCalled()
    })

    it('should detect time as second arg with 90', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['repo', '90'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure (90 is a time, not a repo name).
      expect(process.exitCode).toBe(2)
      expect(mockHandleAnalytics).not.toHaveBeenCalled()
    })

    it('should support --json output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['--json'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['--markdown'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should fail if both --json and --markdown are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['--json', '--markdown'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleAnalytics).not.toHaveBeenCalled()
    })

    it('should pass --file flag to handleAnalytics', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(
        ['--json', '--file', '/tmp/analytics.json'],
        importMeta,
        context,
      )

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          filepath: '/tmp/analytics.json',
          outputKind: 'json',
        }),
      )
    })

    it('should fail if --file used without --json or --markdown', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(
        ['--file', '/tmp/analytics.json'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleAnalytics).not.toHaveBeenCalled()
    })

    it('should allow --file with --markdown', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(
        ['--markdown', '--file', '/tmp/analytics.md'],
        importMeta,
        context,
      )

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          filepath: '/tmp/analytics.md',
          outputKind: 'markdown',
        }),
      )
    })

    it('should show dry-run output with org scope', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['--dry-run', 'org', '7'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('analytics data'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('org'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('7 days'),
      )
    })

    it('should show dry-run output with repo scope', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(
        ['--dry-run', 'repo', 'test-repo', '90'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('repo'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('test-repo'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('90 days'),
      )
    })

    it('should handle all time values correctly', async () => {
      mockHasDefaultApiToken.mockReturnValue(true)

      await cmdAnalytics.run(['7'], importMeta, context)
      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ time: 7 }),
      )

      vi.clearAllMocks()

      await cmdAnalytics.run(['30'], importMeta, context)
      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ time: 30 }),
      )

      vi.clearAllMocks()

      await cmdAnalytics.run(['90'], importMeta, context)
      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ time: 90 }),
      )
    })

    it('should handle repo name with dashes', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['repo', 'my-test-repo'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'my-test-repo',
        }),
      )
    })

    it('should handle repo name with underscores', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['repo', 'my_test_repo'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'my_test_repo',
        }),
      )
    })

    it('should default to 30 days when no time specified', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['org'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          time: 30,
        }),
      )
    })

    it('should default to empty repo name when scope is org', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['org', '7'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'org',
          repo: '',
        }),
      )
    })

    it('should combine all arguments correctly', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(
        ['repo', 'test-repo', '90', '--json', '--file', '/tmp/out.json'],
        importMeta,
        context,
      )

      expect(mockHandleAnalytics).toHaveBeenCalledWith({
        filepath: '/tmp/out.json',
        outputKind: 'json',
        repo: 'test-repo',
        scope: 'repo',
        time: 90,
      })
    })

    it('should handle empty filepath', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAnalytics.run(['--json'], importMeta, context)

      expect(mockHandleAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          filepath: '',
        }),
      )
    })
  })
})
