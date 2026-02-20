/**
 * Unit tests for manifest auto command.
 *
 * Tests the command that auto-detects build systems and generates manifest files.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock detectManifestActions and generateAutoManifest.
const mockDetectManifestActions = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ count: 0 }),
)
const mockGenerateAutoManifest = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../../../../src/commands/manifest/detect-manifest-actions.mts', () => ({
  detectManifestActions: mockDetectManifestActions,
}))

vi.mock('../../../../src/commands/manifest/generate_auto_manifest.mts', () => ({
  generateAutoManifest: mockGenerateAutoManifest,
}))

vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readOrDefaultSocketJson: vi.fn().mockReturnValue({}),
}))

// Import after mocks.
const { cmdManifestAuto } = await import(
  '../../../../src/commands/manifest/cmd-manifest-auto.mts'
)

describe('cmd-manifest-auto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdManifestAuto.description).toBe(
        'Auto-detect build and attempt to generate manifest file',
      )
    })

    it('should not be hidden', () => {
      expect(cmdManifestAuto.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest-auto.mts' }
    const context = { parentName: 'socket manifest' }

    it('should support --dry-run flag', async () => {
      await cmdManifestAuto.run(['--dry-run'], importMeta, context)

      expect(mockGenerateAutoManifest).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should detect manifest actions', async () => {
      await cmdManifestAuto.run(['.'], importMeta, context)

      expect(mockDetectManifestActions).toHaveBeenCalled()
    })

    it('should fail when no targets detected', async () => {
      mockDetectManifestActions.mockResolvedValueOnce({ count: 0 })

      await cmdManifestAuto.run(['.'], importMeta, context)

      expect(process.exitCode).toBe(1)
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('unable to discover'),
      )
    })

    it('should generate manifests when targets detected', async () => {
      mockDetectManifestActions.mockResolvedValueOnce({ count: 2 })

      await cmdManifestAuto.run(['.'], importMeta, context)

      expect(mockGenerateAutoManifest).toHaveBeenCalled()
      expect(mockLogger.success).toHaveBeenCalled()
    })
  })
})
