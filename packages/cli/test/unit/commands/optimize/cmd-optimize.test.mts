/**
 * Unit tests for optimize command.
 *
 * Tests the command that optimizes dependencies with @socketregistry overrides.
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
const mockHandleOptimize = vi.hoisted(() => vi.fn())
const mockDetectAndValidatePackageEnvironment = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    data: {
      agent: 'npm',
      agentVersion: '10.0.0',
      pkgPath: '/test/path',
    },
  }),
)

vi.mock('../../../../src/commands/optimize/handle-optimize.mts', () => ({
  handleOptimize: mockHandleOptimize,
}))

vi.mock('../../../../src/utils/ecosystem/environment.mjs', () => ({
  detectAndValidatePackageEnvironment: mockDetectAndValidatePackageEnvironment,
}))

// Import after mocks.
const { cmdOptimize } =
  await import('../../../../src/commands/optimize/cmd-optimize.mts')

describe('cmd-optimize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdOptimize.description).toBe(
        'Optimize dependencies with @socketregistry overrides',
      )
    })

    it('should not be hidden', () => {
      expect(cmdOptimize.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-optimize.mts' }
    const context = { parentName: 'socket' }

    it('should support --dry-run flag', async () => {
      await cmdOptimize.run(['--dry-run'], importMeta, context)

      expect(mockHandleOptimize).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should detect package environment in dry-run mode', async () => {
      await cmdOptimize.run(['--dry-run'], importMeta, context)

      expect(mockDetectAndValidatePackageEnvironment).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cmdName: 'socket optimize',
          prod: false,
        }),
      )
    })

    it('should show failure in dry-run when package environment detection fails', async () => {
      mockDetectAndValidatePackageEnvironment.mockResolvedValueOnce({
        ok: false,
        error: 'No package.json found',
      })

      await cmdOptimize.run(['--dry-run'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Would fail'),
      )
    })

    it('should call handleOptimize without dry-run flag', async () => {
      await cmdOptimize.run([], importMeta, context)

      expect(mockHandleOptimize).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.any(String),
          pin: false,
          outputKind: 'text',
          prod: false,
        }),
      )
    })

    it('should pass --pin flag to handleOptimize', async () => {
      await cmdOptimize.run(['--pin'], importMeta, context)

      expect(mockHandleOptimize).toHaveBeenCalledWith(
        expect.objectContaining({
          pin: true,
        }),
      )
    })

    it('should pass --prod flag to handleOptimize', async () => {
      await cmdOptimize.run(['--prod'], importMeta, context)

      expect(mockHandleOptimize).toHaveBeenCalledWith(
        expect.objectContaining({
          prod: true,
        }),
      )
    })

    it('should support custom cwd argument', async () => {
      await cmdOptimize.run(['./custom/path'], importMeta, context)

      expect(mockHandleOptimize).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringContaining('custom/path'),
        }),
      )
    })

    it('should support --json output mode', async () => {
      await cmdOptimize.run(['--json'], importMeta, context)

      expect(mockHandleOptimize).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      await cmdOptimize.run(['--markdown'], importMeta, context)

      expect(mockHandleOptimize).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should include pin and prod in dry-run details', async () => {
      await cmdOptimize.run(
        ['--dry-run', '--pin', '--prod'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('pin to specific versions'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('production dependencies only'),
      )
    })

    it('should show agent version in dry-run mode', async () => {
      mockDetectAndValidatePackageEnvironment.mockResolvedValueOnce({
        ok: true,
        data: {
          agent: 'pnpm',
          agentVersion: '9.0.0',
          pkgPath: '/test/path',
        },
      })

      await cmdOptimize.run(['--dry-run'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('pnpm v9.0.0'),
      )
    })
  })
})
