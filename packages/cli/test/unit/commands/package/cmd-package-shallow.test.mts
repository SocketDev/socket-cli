/**
 * Unit tests for package shallow command.
 *
 * Tests the command that looks up shallow scores for one or more packages without their transitives.
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
const mockHandlePurlsShallowScore = vi.hoisted(() => vi.fn())

vi.mock(
  '../../../../src/commands/package/handle-purls-shallow-score.mts',
  () => ({
    handlePurlsShallowScore: mockHandlePurlsShallowScore,
  }),
)

// Import after mocks.
const { cmdPackageShallow } =
  await import('../../../../src/commands/package/cmd-package-shallow.mts')

describe('cmd-package-shallow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdPackageShallow.description).toBe(
        'Look up info regarding one or more packages but not their transitives',
      )
    })

    it('should not be hidden', () => {
      expect(cmdPackageShallow.hidden).toBe(false)
    })

    it('should have shallowScore alias', () => {
      expect(cmdPackageShallow.alias).toBeDefined()
      expect(cmdPackageShallow.alias?.shallowScore).toBeDefined()
      expect(cmdPackageShallow.alias?.shallowScore.hidden).toBe(true)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-package-shallow.mts' }
    const context = { parentName: 'socket package' }

    it('should support --dry-run flag', async () => {
      await cmdPackageShallow.run(
        ['--dry-run', 'npm', 'webtorrent'],
        importMeta,
        context,
      )

      expect(mockHandlePurlsShallowScore).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without package name', async () => {
      await cmdPackageShallow.run([], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandlePurlsShallowScore).not.toHaveBeenCalled()
    })

    it('should call handlePurlsShallowScore with single package', async () => {
      await cmdPackageShallow.run(['npm', 'webtorrent'], importMeta, context)

      expect(mockHandlePurlsShallowScore).toHaveBeenCalledWith({
        outputKind: 'text',
        purls: ['pkg:npm/webtorrent'],
      })
    })

    it('should handle multiple packages with same ecosystem', async () => {
      await cmdPackageShallow.run(
        ['npm', 'webtorrent', 'babel'],
        importMeta,
        context,
      )

      expect(mockHandlePurlsShallowScore).toHaveBeenCalledWith({
        outputKind: 'text',
        purls: ['pkg:npm/webtorrent', 'pkg:npm/babel'],
      })
    })

    it('should handle purl format with pkg: prefix', async () => {
      await cmdPackageShallow.run(
        ['pkg:npm/webtorrent@1.9.1'],
        importMeta,
        context,
      )

      expect(mockHandlePurlsShallowScore).toHaveBeenCalledWith({
        outputKind: 'text',
        purls: ['pkg:npm/webtorrent@1.9.1'],
      })
    })

    it('should handle purl format without pkg: prefix', async () => {
      await cmdPackageShallow.run(['npm/webtorrent@1.9.1'], importMeta, context)

      expect(mockHandlePurlsShallowScore).toHaveBeenCalledWith({
        outputKind: 'text',
        purls: ['pkg:npm/webtorrent@1.9.1'],
      })
    })

    it('should handle mixed purl formats with same ecosystem', async () => {
      await cmdPackageShallow.run(
        ['npm', 'webtorrent@1.0.1', 'babel'],
        importMeta,
        context,
      )

      expect(mockHandlePurlsShallowScore).toHaveBeenCalledWith({
        outputKind: 'text',
        purls: ['pkg:npm/webtorrent@1.0.1', 'pkg:npm/babel'],
      })
    })

    it('should handle multiple purls from different ecosystems', async () => {
      await cmdPackageShallow.run(
        ['npm/webtorrent', 'golang/babel'],
        importMeta,
        context,
      )

      expect(mockHandlePurlsShallowScore).toHaveBeenCalledWith({
        outputKind: 'text',
        purls: ['pkg:npm/webtorrent', 'pkg:golang/babel'],
      })
    })

    it('should pass --json flag to handlePurlsShallowScore', async () => {
      await cmdPackageShallow.run(
        ['npm', 'webtorrent', '--json'],
        importMeta,
        context,
      )

      expect(mockHandlePurlsShallowScore).toHaveBeenCalledWith({
        outputKind: 'json',
        purls: ['pkg:npm/webtorrent'],
      })
    })

    it('should pass --markdown flag to handlePurlsShallowScore', async () => {
      await cmdPackageShallow.run(
        ['npm', 'webtorrent', '--markdown'],
        importMeta,
        context,
      )

      expect(mockHandlePurlsShallowScore).toHaveBeenCalledWith({
        outputKind: 'markdown',
        purls: ['pkg:npm/webtorrent'],
      })
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      await cmdPackageShallow.run(
        ['npm', 'webtorrent', '--json', '--markdown'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandlePurlsShallowScore).not.toHaveBeenCalled()
    })

    it('should handle package with version', async () => {
      await cmdPackageShallow.run(
        ['npm', 'webtorrent@1.9.1'],
        importMeta,
        context,
      )

      expect(mockHandlePurlsShallowScore).toHaveBeenCalledWith({
        outputKind: 'text',
        purls: ['pkg:npm/webtorrent@1.9.1'],
      })
    })

    it('should handle different ecosystems', async () => {
      await cmdPackageShallow.run(
        ['maven', 'webtorrent', 'babel'],
        importMeta,
        context,
      )

      expect(mockHandlePurlsShallowScore).toHaveBeenCalledWith({
        outputKind: 'text',
        purls: ['pkg:maven/webtorrent', 'pkg:maven/babel'],
      })
    })

    it('should show query parameters in dry-run mode', async () => {
      await cmdPackageShallow.run(
        ['--dry-run', 'npm', 'webtorrent', 'babel'],
        importMeta,
        context,
      )

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[DryRun]: Would fetch package information'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('packages: pkg:npm/webtorrent, pkg:npm/babel'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('count: 2'),
      )
    })

    it('should fail with invalid first parameter', async () => {
      await cmdPackageShallow.run(
        ['not-an-ecosystem-or-purl'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandlePurlsShallowScore).not.toHaveBeenCalled()
    })
  })
})
