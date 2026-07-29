/**
 * Unit tests for manifest maven command.
 *
 * Tests the facts-only command that resolves a Maven project's dependency
 * graph through the bundled extension.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdManifestMaven } from '../../../../src/commands/manifest/cmd-manifest-maven.mts'

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

const mockConvertMavenToFacts = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
)
const mockOutputManifest = vi.hoisted(() => vi.fn())
const mockReadOrDefaultSocketJson = vi.hoisted(() =>
  vi.fn().mockReturnValue({}),
)

vi.mock(
  import('../../../../src/commands/manifest/convert-maven-to-facts.mts'),
  () => ({
    convertMavenToFacts: mockConvertMavenToFacts,
  }),
)

vi.mock(
  import('../../../../src/commands/manifest/output-manifest.mts'),
  () => ({
    outputManifest: mockOutputManifest,
  }),
)

vi.mock(import('../../../../src/util/socket/json.mts'), () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
}))

describe('cmd-manifest-maven', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdManifestMaven.description).toContain('Maven')
      expect(cmdManifestMaven.description).toContain('facts')
    })

    it('should not be hidden', () => {
      expect(cmdManifestMaven.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest-maven.mts' }
    const context = { parentName: 'socket manifest' }

    it('should support --dry-run flag', async () => {
      await cmdManifestMaven.run(['--dry-run', '.'], importMeta, context)

      expect(mockConvertMavenToFacts).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('generates facts with expected default parameters', async () => {
      await cmdManifestMaven.run(['.'], importMeta, context)

      expect(mockConvertMavenToFacts).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: 'mvn',
          excludeConfigs: '',
          excludePaths: [],
          ignoreUnresolved: false,
          includeConfigs: '',
          mavenOpts: [],
          verbose: false,
        }),
      )
    })

    it('forwards --include-configs, --exclude-configs, and --ignore-unresolved', async () => {
      await cmdManifestMaven.run(
        [
          '--include-configs=compile,runtime',
          '--exclude-configs=test',
          '--ignore-unresolved',
          '.',
        ],
        importMeta,
        context,
      )

      expect(mockConvertMavenToFacts).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeConfigs: 'test',
          ignoreUnresolved: true,
          includeConfigs: 'compile,runtime',
        }),
      )
    })

    it('parses --maven-opts into argv tokens', async () => {
      await cmdManifestMaven.run(
        ['--maven-opts=-P release -s settings.xml', '.'],
        importMeta,
        context,
      )

      expect(mockConvertMavenToFacts).toHaveBeenCalledWith(
        expect.objectContaining({
          mavenOpts: ['-P', 'release', '-s', 'settings.xml'],
        }),
      )
    })

    it('refuses a socket.json bin that redirects away from the wrapper', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            maven: {
              bin: '/socket-json/mvn',
            },
          },
        },
      })

      await cmdManifestMaven.run(['.'], importMeta, context)

      expect(mockConvertMavenToFacts).not.toHaveBeenCalled()
      expect(mockOutputManifest).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          message: expect.stringContaining('Refused a maven binary'),
        }),
        'text',
        '-',
      )
    })

    it('uses a socket.json bin under --trust-socket-json', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            maven: {
              bin: '/socket-json/mvn',
            },
          },
        },
      })

      await cmdManifestMaven.run(
        ['--trust-socket-json', '.'],
        importMeta,
        context,
      )

      expect(mockConvertMavenToFacts).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: '/socket-json/mvn',
        }),
      )
    })

    it('refuses socket.json mavenOpts untrusted', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            maven: {
              mavenOpts: '-Dmaven.ext.class.path=/tmp/payload.jar',
            },
          },
        },
      })

      await cmdManifestMaven.run(['.'], importMeta, context)

      expect(mockConvertMavenToFacts).not.toHaveBeenCalled()
      expect(mockOutputManifest).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          message: expect.stringContaining('Refused maven options'),
        }),
        'text',
        '-',
      )
    })

    it('honors non-executing socket.json defaults untrusted', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            maven: {
              excludeConfigs: 'test',
              ignoreUnresolved: true,
              includeConfigs: 'compile',
            },
          },
        },
      })

      await cmdManifestMaven.run(['.'], importMeta, context)

      expect(mockConvertMavenToFacts).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeConfigs: 'test',
          ignoreUnresolved: true,
          includeConfigs: 'compile',
        }),
      )
    })

    it('rejects multiple directory arguments', async () => {
      await cmdManifestMaven.run(['dir1', 'dir2'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockConvertMavenToFacts).not.toHaveBeenCalled()
    })
  })
})
