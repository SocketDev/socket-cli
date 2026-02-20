/**
 * Unit tests for manifest gradle command.
 *
 * Tests the command that uses Gradle to generate pom.xml manifest files.
 */

import path from 'node:path'

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

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock convertGradleToMaven and outputManifest.
const mockConvertGradleToMaven = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, data: { files: [] } }),
)
const mockOutputManifest = vi.hoisted(() => vi.fn())
const mockReadOrDefaultSocketJson = vi.hoisted(() => vi.fn().mockReturnValue({}))

vi.mock('../../../../src/commands/manifest/convert-gradle-to-maven.mts', () => ({
  convertGradleToMaven: mockConvertGradleToMaven,
}))

vi.mock('../../../../src/commands/manifest/output-manifest.mts', () => ({
  outputManifest: mockOutputManifest,
}))

vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
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

    it('should call convertGradleToMaven with correct default parameters', async () => {
      await cmdManifestGradle.run(['.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith({
        bin: expect.stringMatching(/gradlew$/),
        cwd: expect.stringContaining('/'),
        gradleOpts: [],
        outputKind: 'text',
        verbose: false,
      })
    })

    it('should pass custom --bin flag to convertGradleToMaven', async () => {
      await cmdManifestGradle.run(['--bin', '/custom/gradle', '.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: '/custom/gradle',
        }),
      )
    })

    it('should parse and pass --gradle-opts flag', async () => {
      // Use = syntax for values that look like flags.
      await cmdManifestGradle.run(
        ['--gradle-opts=--stacktrace --info', '.'],
        importMeta,
        context,
      )

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          gradleOpts: ['--stacktrace', '--info'],
        }),
      )
    })

    it('should pass --verbose flag to convertGradleToMaven', async () => {
      await cmdManifestGradle.run(['--verbose', '.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
        }),
      )
    })

    it('should use socket.json defaults for bin', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            gradle: {
              bin: '/socket-json/gradlew',
            },
          },
        },
      })

      await cmdManifestGradle.run(['.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: '/socket-json/gradlew',
        }),
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('--bin'),
        '/socket-json/gradlew',
      )
    })

    it('should use socket.json defaults for gradleOpts', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            gradle: {
              gradleOpts: '--debug --scan',
            },
          },
        },
      })

      await cmdManifestGradle.run(['.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          gradleOpts: ['--debug', '--scan'],
        }),
      )
    })

    it('should use socket.json defaults for verbose', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            gradle: {
              verbose: true,
            },
          },
        },
      })

      await cmdManifestGradle.run(['.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
        }),
      )
    })

    it('should reject multiple directory arguments', async () => {
      await cmdManifestGradle.run(['dir1', 'dir2'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
    })

    it('should output manifest in json mode', async () => {
      const result = { ok: true, data: { files: ['pom.xml'] } }
      mockConvertGradleToMaven.mockResolvedValueOnce(result)

      await cmdManifestGradle.run(['--json', '.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
      expect(mockOutputManifest).toHaveBeenCalledWith(result, 'json', '-')
    })

    it('should output manifest in markdown mode', async () => {
      const result = { ok: true, data: { files: [] } }
      mockConvertGradleToMaven.mockResolvedValueOnce(result)

      await cmdManifestGradle.run(['--markdown', '.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
      expect(mockOutputManifest).toHaveBeenCalledWith(result, 'markdown', '-')
    })

    it('should not call outputManifest in text mode', async () => {
      await cmdManifestGradle.run(['.'], importMeta, context)

      expect(mockOutputManifest).not.toHaveBeenCalled()
    })

    it('should resolve cwd to absolute path', async () => {
      await cmdManifestGradle.run(['./relative'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringMatching(/^\/.*relative$/),
        }),
      )
    })

    it('should default bin to gradlew in cwd', async () => {
      await cmdManifestGradle.run(['/absolute/path'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: path.join('/absolute/path', 'gradlew'),
          cwd: '/absolute/path',
        }),
      )
    })

    it('should override socket.json defaults with CLI flags', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            gradle: {
              bin: '/socket-json/gradlew',
              verbose: false,
            },
          },
        },
      })

      await cmdManifestGradle.run(
        ['--bin', '/cli/gradlew', '--verbose', '.'],
        importMeta,
        context,
      )

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: '/cli/gradlew',
          verbose: true,
        }),
      )
    })
  })
})
