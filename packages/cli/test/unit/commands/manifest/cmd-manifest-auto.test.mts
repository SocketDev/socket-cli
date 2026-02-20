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
  vi.fn().mockResolvedValue({ count: 0, gradle: false, sbt: false, pip: false }),
)
const mockGenerateAutoManifest = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockReadOrDefaultSocketJson = vi.hoisted(() => vi.fn().mockReturnValue({}))

vi.mock('../../../../src/commands/manifest/detect-manifest-actions.mts', () => ({
  detectManifestActions: mockDetectManifestActions,
}))

vi.mock('../../../../src/commands/manifest/generate_auto_manifest.mts', () => ({
  generateAutoManifest: mockGenerateAutoManifest,
}))

vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
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
      mockDetectManifestActions.mockResolvedValueOnce({ count: 2 })

      await cmdManifestAuto.run(['--dry-run'], importMeta, context)

      // Dry run should still detect but not generate.
      expect(mockDetectManifestActions).toHaveBeenCalled()
      expect(mockGenerateAutoManifest).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should detect manifest actions with socket.json config', async () => {
      const mockSocketJson = { defaults: { manifest: { auto: {} } } }
      mockReadOrDefaultSocketJson.mockReturnValueOnce(mockSocketJson)
      mockDetectManifestActions.mockResolvedValueOnce({ count: 0 })

      await cmdManifestAuto.run(['.'], importMeta, context)

      // Verify detectManifestActions receives socket.json and cwd.
      expect(mockDetectManifestActions).toHaveBeenCalledWith(
        mockSocketJson,
        expect.stringContaining('/'),
      )
    })

    it('should fail when no targets detected', async () => {
      mockDetectManifestActions.mockResolvedValueOnce({ count: 0 })

      await cmdManifestAuto.run(['.'], importMeta, context)

      expect(process.exitCode).toBe(1)
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('unable to discover'),
      )
      expect(mockGenerateAutoManifest).not.toHaveBeenCalled()
    })

    it('should generate manifests when targets detected', async () => {
      const detected = { count: 2, gradle: true, sbt: false, pip: true }
      mockDetectManifestActions.mockResolvedValueOnce(detected)

      await cmdManifestAuto.run(['.'], importMeta, context)

      // Verify generateAutoManifest receives correct parameters.
      expect(mockGenerateAutoManifest).toHaveBeenCalledWith({
        detected,
        cwd: expect.stringContaining('/'),
        outputKind: 'text',
        verbose: false,
      })
      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('2 targets'),
      )
    })

    it('should pass verbose flag to generateAutoManifest', async () => {
      const detected = { count: 1 }
      mockDetectManifestActions.mockResolvedValueOnce(detected)

      await cmdManifestAuto.run(['--verbose', '.'], importMeta, context)

      expect(mockGenerateAutoManifest).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
        }),
      )
    })

    it('should resolve relative cwd to absolute path', async () => {
      mockDetectManifestActions.mockResolvedValueOnce({ count: 0 })

      await cmdManifestAuto.run(['./relative/path'], importMeta, context)

      // Verify cwd is absolute (contains process.cwd()).
      expect(mockDetectManifestActions).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/^\/.*relative\/path$/),
      )
    })

    it('should use current directory when no path provided', async () => {
      mockDetectManifestActions.mockResolvedValueOnce({ count: 0 })

      await cmdManifestAuto.run([], importMeta, context)

      // Should use process.cwd() when no path provided.
      expect(mockDetectManifestActions).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/^\/.*$/),
      )
    })
  })
})
