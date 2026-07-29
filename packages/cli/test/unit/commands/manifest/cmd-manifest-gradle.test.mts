/**
 * Unit tests for manifest gradle command.
 *
 * Tests the command that uses Gradle to generate pom.xml manifest files.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { cmdManifestGradle } from '../../../../src/commands/manifest/cmd-manifest-gradle.mts'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'

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

vi.mock(
  import('@socketsecurity/lib-stable/logger/default'),
  async importOriginal => {
    const actual = await importOriginal<typeof LoggerModule>()
    return {
      ...actual,
      getDefaultLogger: () => mockLogger,
    }
  },
)

// Mock convertGradleToMaven and outputManifest.
const mockConvertGradleToMaven = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, data: { files: [] } }),
)
const mockConvertToFacts = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
)
const mockOutputManifest = vi.hoisted(() => vi.fn())
const mockReadOrDefaultSocketJson = vi.hoisted(() =>
  vi.fn().mockReturnValue({}),
)

vi.mock(
  import('../../../../src/commands/manifest/convert-gradle-to-maven.mts'),
  () => ({
    convertGradleToMaven: mockConvertGradleToMaven,
  }),
)

vi.mock(
  import('../../../../src/commands/manifest/output-manifest.mts'),
  () => ({
    outputManifest: mockOutputManifest,
  }),
)

vi.mock(
  import('../../../../src/commands/manifest/convert-gradle-to-facts.mts'),
  () => ({
    convertGradleToFacts: mockConvertToFacts,
  }),
)

vi.mock(import('../../../../src/util/socket/json.mts'), () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
}))

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
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('forwards --gradle-opts and --bin in the dry-run preview args', async () => {
      // Exercises the args.push branches in the dryRun block.
      await cmdManifestGradle.run(
        [
          '--dry-run',
          '.',
          '--bin',
          '/custom/gradlew',
          '--gradle-opts',
          '--stacktrace --info',
        ],
        importMeta,
        context,
      )
      expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should call convertGradleToMaven with correct default parameters', async () => {
      await cmdManifestGradle.run(['--pom', '.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith({
        // The test cwd ships no gradlew wrapper, so the default falls back to
        // `gradle` on PATH.
        bin: expect.stringMatching(/^gradle$|gradlew$/),
        cwd: expect.stringContaining('/'),
        gradleOpts: [],
        outputKind: 'text',
        verbose: false,
      })
    })

    it('should pass custom --bin flag to convertGradleToMaven', async () => {
      await cmdManifestGradle.run(
        ['--pom', '--bin', '/custom/gradle', '.'],
        importMeta,
        context,
      )

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: '/custom/gradle',
        }),
      )
    })

    it('should parse and pass --gradle-opts flag', async () => {
      // Use = syntax for values that look like flags.
      await cmdManifestGradle.run(
        ['--pom', '--gradle-opts=--stacktrace --info', '.'],
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
      await cmdManifestGradle.run(
        ['--pom', '--verbose', '.'],
        importMeta,
        context,
      )

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
        }),
      )
    })

    it('should refuse a socket.json bin that redirects away from the wrapper', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            gradle: {
              bin: '/socket-json/gradlew',
            },
          },
        },
      })

      await cmdManifestGradle.run(['--pom', '.'], importMeta, context)

      expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
      expect(mockOutputManifest).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          message: expect.stringContaining('Refused a gradle binary'),
        }),
        'text',
        '-',
      )
    })

    it('should use a socket.json bin under --trust-socket-json', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            gradle: {
              bin: '/socket-json/gradlew',
            },
          },
        },
      })

      await cmdManifestGradle.run(
        ['--pom', '--trust-socket-json', '.'],
        importMeta,
        context,
      )

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: '/socket-json/gradlew',
        }),
      )
    })

    it('should refuse socket.json gradleOpts', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            gradle: {
              gradleOpts: '--init-script /tmp/payload.gradle',
            },
          },
        },
      })

      await cmdManifestGradle.run(['--pom', '.'], importMeta, context)

      expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
      expect(mockOutputManifest).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          message: expect.stringContaining('Refused gradle options'),
        }),
        'text',
        '-',
      )
    })

    it('should use socket.json gradleOpts under --trust-socket-json', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            gradle: {
              gradleOpts: '--debug --scan',
            },
          },
        },
      })

      await cmdManifestGradle.run(
        ['--pom', '--trust-socket-json', '.'],
        importMeta,
        context,
      )

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

      await cmdManifestGradle.run(['--pom', '.'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
        }),
      )
    })

    it('should reject multiple directory arguments', async () => {
      await cmdManifestGradle.run(
        ['--pom', 'dir1', 'dir2'],
        importMeta,
        context,
      )

      expect(process.exitCode).toBe(2)
      expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
    })

    it('should output manifest in json mode', async () => {
      const result = { ok: true, data: { files: ['pom.xml'] } }
      mockConvertGradleToMaven.mockResolvedValueOnce(result)

      await cmdManifestGradle.run(['--pom', '--json', '.'], importMeta, context)

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

      await cmdManifestGradle.run(
        ['--pom', '--markdown', '.'],
        importMeta,
        context,
      )

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
      expect(mockOutputManifest).toHaveBeenCalledWith(result, 'markdown', '-')
    })

    it('should not call outputManifest in text mode', async () => {
      await cmdManifestGradle.run(['--pom', '.'], importMeta, context)

      expect(mockOutputManifest).not.toHaveBeenCalled()
    })

    it('should resolve cwd to absolute path', async () => {
      await cmdManifestGradle.run(['--pom', './relative'], importMeta, context)

      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringMatching(/^\/.*relative$/),
        }),
      )
    })

    it('should prefer the cwd gradlew wrapper and fall back to gradle on PATH', async () => {
      const tmpCwd = mkdtempSync(path.join(os.tmpdir(), 'cmd-gradle-'))
      try {
        writeFileSync(path.join(tmpCwd, 'gradlew'), '')
        await cmdManifestGradle.run(['--pom', tmpCwd], importMeta, context)
        expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
          expect.objectContaining({
            bin: path.join(tmpCwd, 'gradlew'),
            cwd: tmpCwd,
          }),
        )
      } finally {
        await safeDelete(tmpCwd)
      }

      // No wrapper in the cwd → gradle on PATH.
      await cmdManifestGradle.run(
        ['--pom', '/absolute/path'],
        importMeta,
        context,
      )
      expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
        expect.objectContaining({ bin: 'gradle', cwd: '/absolute/path' }),
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
        ['--pom', '--bin', '/cli/gradlew', '--verbose', '.'],
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
  describe('facts generation', () => {
    const importMeta = { url: 'file:///test/cmdManifestGradle.mts' }
    const context = { parentName: 'socket manifest' }

    it('generates facts by default with expected parameters', async () => {
      await cmdManifestGradle.run(['.'], importMeta, context)

      expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
      expect(mockConvertToFacts).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeConfigs: '',
          excludePaths: [],
          ignoreUnresolved: false,
          includeConfigs: '',
          verbose: false,
        }),
      )
    })

    it('forwards --include-configs, --exclude-configs, and --ignore-unresolved', async () => {
      await cmdManifestGradle.run(
        [
          '--include-configs=*CompileClasspath',
          '--exclude-configs=test*',
          '--ignore-unresolved',
          '.',
        ],
        importMeta,
        context,
      )

      expect(mockConvertToFacts).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeConfigs: 'test*',
          ignoreUnresolved: true,
          includeConfigs: '*CompileClasspath',
        }),
      )
    })

    it('forwards --exclude-paths as an array', async () => {
      await cmdManifestGradle.run(
        ['--exclude-paths=vendor,legacy', '.'],
        importMeta,
        context,
      )

      expect(mockConvertToFacts).toHaveBeenCalledWith(
        expect.objectContaining({
          excludePaths: ['vendor', 'legacy'],
        }),
      )
    })

    it('warns and keeps facts when --pom and --facts are both passed', async () => {
      await cmdManifestGradle.run(
        ['--pom', '--facts', '.'],
        importMeta,
        context,
      )

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('mutually exclusive'),
      )
      expect(mockConvertToFacts).toHaveBeenCalled()
      expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
    })

    it('honors a socket.json facts:false default untrusted', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            gradle: {
              facts: false,
            },
          },
        },
      })

      await cmdManifestGradle.run(['.'], importMeta, context)

      expect(mockConvertToFacts).not.toHaveBeenCalled()
      expect(mockConvertGradleToMaven).toHaveBeenCalled()
    })
  })
})
