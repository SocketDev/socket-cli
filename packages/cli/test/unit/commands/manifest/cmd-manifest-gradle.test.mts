/**
 * Unit tests for manifest gradle command.
 *
 * Tests the command that uses Gradle to generate pom.xml manifest files.
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

// Mock convertGradleToMaven and outputManifest.
const mockConvertGradleToMaven = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, data: {} }),
)
const mockOutputManifest = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/manifest/convert-gradle-to-maven.mts', () => ({
  convertGradleToMaven: mockConvertGradleToMaven,
}))

vi.mock('../../../../src/commands/manifest/output-manifest.mts', () => ({
  outputManifest: mockOutputManifest,
}))

vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readOrDefaultSocketJson: vi.fn().mockReturnValue({}),
}))

// Import after mocks.
const { cmdManifestGradle } = await import(
  '../../../../src/commands/manifest/cmd-manifest-gradle.mts'
)

describe('cmd-manifest-gradle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdManifestGradle.description).toContain('Gradle')
      expect(cmdManifestGradle.description).toContain('pom.xml')
    })

    it('should not be hidden', () => {
      expect(cmdManifestGradle.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest-gradle.mts' }
    const context = { parentName: 'socket manifest' }

    it('should support --dry-run flag', async () => {
      await cmdManifestGradle.run(['--dry-run', '.'], importMeta, context)

      expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should call convertGradleToMaven', async () => {
      await cmdManifestGradle.run(['.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalled()
    })

    it('should output manifest in json mode', async () => {
      mockConvertGradleToMaven.mockResolvedValueOnce({ ok: true, data: { files: [] } })

      await cmdManifestGradle.run(['--json', '.'], importMeta, context)

      expect(mockOutputManifest).toHaveBeenCalled()
    })
  })
})
