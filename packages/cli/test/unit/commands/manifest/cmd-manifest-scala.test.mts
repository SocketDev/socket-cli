/**
 * Unit tests for manifest scala command.
 *
 * Tests the command that uses SBT to generate pom.xml manifest files for Scala projects.
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

// Mock convertSbtToMaven and outputManifest.
const mockConvertSbtToMaven = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, data: {} }),
)
const mockOutputManifest = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/manifest/convert-sbt-to-maven.mts', () => ({
  convertSbtToMaven: mockConvertSbtToMaven,
}))

vi.mock('../../../../src/commands/manifest/output-manifest.mts', () => ({
  outputManifest: mockOutputManifest,
}))

vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readOrDefaultSocketJson: vi.fn().mockReturnValue({}),
}))

// Import after mocks.
const { cmdManifestScala } = await import(
  '../../../../src/commands/manifest/cmd-manifest-scala.mts'
)

describe('cmd-manifest-scala', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdManifestScala.description).toContain('Scala')
      expect(cmdManifestScala.description).toContain('pom.xml')
    })

    it('should not be hidden', () => {
      expect(cmdManifestScala.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest-scala.mts' }
    const context = { parentName: 'socket manifest' }

    it('should support --dry-run flag', async () => {
      await cmdManifestScala.run(['--dry-run', '.'], importMeta, context)

      expect(mockConvertSbtToMaven).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should call convertSbtToMaven', async () => {
      await cmdManifestScala.run(['.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalled()
    })

    it('should output manifest in json mode', async () => {
      mockConvertSbtToMaven.mockResolvedValueOnce({ ok: true, data: { files: [] } })

      await cmdManifestScala.run(['--json', '.'], importMeta, context)

      expect(mockOutputManifest).toHaveBeenCalled()
    })
  })
})
