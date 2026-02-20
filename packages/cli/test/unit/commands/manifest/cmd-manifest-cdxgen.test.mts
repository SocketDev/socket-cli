/**
 * Unit tests for manifest cdxgen command.
 *
 * Tests the cdxgen command that generates CycloneDX SBOMs (Software Bill of Materials).
 * This command wraps the @cyclonedx/cdxgen tool with Socket CLI integration.
 *
 * Test Coverage:
 * - Command metadata (description, hidden)
 * - Dry-run behavior
 * - Unknown argument handling
 *
 * Note: Tests that would trigger process.exit() are tested via integration tests
 * since Vitest catches process.exit() as an error.
 *
 * Related Files:
 * - src/commands/manifest/cmd-manifest-cdxgen.mts - Command implementation
 * - src/commands/manifest/run-cdxgen.mts - cdxgen spawning logic
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
}))

// Mock runCdxgen to prevent actual cdxgen execution.
const mockRunCdxgen = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/manifest/run-cdxgen.mts', () => ({
  runCdxgen: mockRunCdxgen,
}))

// Import after mocks.
const { cmdManifestCdxgen } = await import(
  '../../../../src/commands/manifest/cmd-manifest-cdxgen.mts'
)

describe('cmd-manifest-cdxgen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdManifestCdxgen.description).toBe(
        'Run cdxgen for SBOM generation',
      )
    })

    it('should not be hidden', () => {
      expect(cmdManifestCdxgen.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest-cdxgen.mts' }
    const context = { parentName: 'socket manifest' }

    it('should support --dry-run flag', async () => {
      await cmdManifestCdxgen.run(['--dry-run'], importMeta, context)

      // Dry run should not call runCdxgen.
      expect(mockRunCdxgen).not.toHaveBeenCalled()
      // Should log the dry run message.
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail on unknown arguments', async () => {
      await cmdManifestCdxgen.run(['unknown-fake-arg'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Unknown argument'),
      )
      expect(mockRunCdxgen).not.toHaveBeenCalled()
    })

    it('should fail on multiple unknown arguments', async () => {
      await cmdManifestCdxgen.run(
        ['fake-arg-1', 'fake-arg-2'],
        importMeta,
        context,
      )

      expect(process.exitCode).toBe(2)
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Unknown arguments'),
      )
    })
  })
})
