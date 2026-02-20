/**
 * Unit tests for manifest kotlin command.
 *
 * Tests the command that uses Gradle to generate pom.xml manifest files for Kotlin projects.
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
const { cmdManifestKotlin } = await import(
  '../../../../src/commands/manifest/cmd-manifest-kotlin.mts'
)

describe('cmd-manifest-kotlin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdManifestKotlin.description).toContain('Kotlin')
      expect(cmdManifestKotlin.description).toContain('pom.xml')
    })

    it('should not be hidden', () => {
      expect(cmdManifestKotlin.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest-kotlin.mts' }
    const context = { parentName: 'socket manifest' }

    it('should support --dry-run flag', async () => {
      await cmdManifestKotlin.run(['--dry-run', '.'], importMeta, context)

      expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should call convertGradleToMaven', async () => {
      await cmdManifestKotlin.run(['.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalled()
    })

    it('should output manifest in json mode', async () => {
      mockConvertGradleToMaven.mockResolvedValueOnce({ ok: true, data: { files: [] } })

      await cmdManifestKotlin.run(['--json', '.'], importMeta, context)

      expect(mockOutputManifest).toHaveBeenCalled()
    })
  })
})
