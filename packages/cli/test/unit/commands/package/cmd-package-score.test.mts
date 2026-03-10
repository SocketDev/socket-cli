/**
 * Unit tests for package score command.
 *
 * Tests the command that looks up deep score for one package including its transitive dependencies.
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
  const actual = await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock dependencies.
const mockHandlePurlDeepScore = vi.hoisted(() => vi.fn())
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('../../../../src/commands/package/handle-purl-deep-score.mts', () => ({
  handlePurlDeepScore: mockHandlePurlDeepScore,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/utils/socket/sdk.mjs')>()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

// Import after mocks.
const { cmdPackageScore } = await import(
  '../../../../src/commands/package/cmd-package-score.mts'
)

describe('cmd-package-score', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdPackageScore.description).toBe(
        'Look up score for one package which reflects all of its transitive dependencies as well'
      )
    })

    it('should not be hidden', () => {
      expect(cmdPackageScore.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-package-score.mts' }
    const context = { parentName: 'socket package' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['--dry-run', 'npm', 'babel-cli'],
        importMeta,
        context,
      )

      expect(mockHandlePurlDeepScore).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdPackageScore.run(
        ['npm', 'babel-cli'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandlePurlDeepScore).not.toHaveBeenCalled()
    })

    it('should fail without package name', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        [],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandlePurlDeepScore).not.toHaveBeenCalled()
    })

    it('should call handlePurlDeepScore with ecosystem and package name', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['npm', 'babel-cli'],
        importMeta,
        context,
      )

      expect(mockHandlePurlDeepScore).toHaveBeenCalledWith(
        'pkg:npm/babel-cli',
        'text',
      )
    })

    it('should handle purl format with pkg: prefix', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['pkg:npm/babel-cli@1.0.0'],
        importMeta,
        context,
      )

      expect(mockHandlePurlDeepScore).toHaveBeenCalledWith(
        'pkg:npm/babel-cli@1.0.0',
        'text',
      )
    })

    it('should handle purl format without pkg: prefix', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['npm/babel-cli@1.0.0'],
        importMeta,
        context,
      )

      expect(mockHandlePurlDeepScore).toHaveBeenCalledWith(
        'pkg:npm/babel-cli@1.0.0',
        'text',
      )
    })

    it('should pass --json flag to handlePurlDeepScore', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['npm', 'babel-cli', '--json'],
        importMeta,
        context,
      )

      expect(mockHandlePurlDeepScore).toHaveBeenCalledWith(
        'pkg:npm/babel-cli',
        'json',
      )
    })

    it('should pass --markdown flag to handlePurlDeepScore', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['npm', 'babel-cli', '--markdown'],
        importMeta,
        context,
      )

      expect(mockHandlePurlDeepScore).toHaveBeenCalledWith(
        'pkg:npm/babel-cli',
        'markdown',
      )
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['npm', 'babel-cli', '--json', '--markdown'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandlePurlDeepScore).not.toHaveBeenCalled()
    })

    it('should handle package with version', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['npm', 'eslint@1.0.0'],
        importMeta,
        context,
      )

      expect(mockHandlePurlDeepScore).toHaveBeenCalledWith(
        'pkg:npm/eslint@1.0.0',
        'text',
      )
    })

    it('should handle different ecosystems', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['pypi', 'requests'],
        importMeta,
        context,
      )

      expect(mockHandlePurlDeepScore).toHaveBeenCalledWith(
        'pkg:pypi/requests',
        'text',
      )
    })

    it('should show query parameters in dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['--dry-run', 'npm', 'babel-cli'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('[DryRun]: Would fetch package score'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('package: pkg:npm/babel-cli'),
      )
    })

    it('should handle golang purl with github namespace', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['pkg:golang/github.com/steelpoor/tlsproxy@v0.0.0-20250304082521-29051ed19c60'],
        importMeta,
        context,
      )

      expect(mockHandlePurlDeepScore).toHaveBeenCalledWith(
        'pkg:golang/github.com/steelpoor/tlsproxy@v0.0.0-20250304082521-29051ed19c60',
        'text',
      )
    })

    it('should handle nuget purl', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdPackageScore.run(
        ['nuget/needpluscommonlibrary@1.0.0', '--markdown'],
        importMeta,
        context,
      )

      expect(mockHandlePurlDeepScore).toHaveBeenCalledWith(
        'pkg:nuget/needpluscommonlibrary@1.0.0',
        'markdown',
      )
    })
  })
})
