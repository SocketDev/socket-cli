/**
 * Unit tests for manifest scala command.
 *
 * Tests the command that uses SBT to generate pom.xml manifest files for Scala
 * projects.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdManifestScala } from '../../../../src/commands/manifest/cmd-manifest-scala.mts'

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

// Mock convertSbtToMaven and outputManifest.
const mockConvertSbtToMaven = vi.hoisted(() =>
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
  import('../../../../src/commands/manifest/convert-sbt-to-maven.mts'),
  () => ({
    convertSbtToMaven: mockConvertSbtToMaven,
  }),
)

vi.mock(
  import('../../../../src/commands/manifest/output-manifest.mts'),
  () => ({
    outputManifest: mockOutputManifest,
  }),
)

vi.mock(
  import('../../../../src/commands/manifest/convert-sbt-to-facts.mts'),
  () => ({
    convertSbtToFacts: mockConvertToFacts,
  }),
)

vi.mock(import('../../../../src/util/socket/json.mts'), () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
}))

describe('cmd-manifest-scala facts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })
  describe('facts generation', () => {
    const importMeta = { url: 'file:///test/cmdManifestScala.mts' }
    const context = { parentName: 'socket manifest' }

    it('generates facts by default with expected parameters', async () => {
      await cmdManifestScala.run(['.'], importMeta, context)

      expect(mockConvertSbtToMaven).not.toHaveBeenCalled()
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
      await cmdManifestScala.run(
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
      await cmdManifestScala.run(
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
      await cmdManifestScala.run(['--pom', '--facts', '.'], importMeta, context)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('mutually exclusive'),
      )
      expect(mockConvertToFacts).toHaveBeenCalled()
      expect(mockConvertSbtToMaven).not.toHaveBeenCalled()
    })

    it('honors a socket.json facts:false default untrusted', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            sbt: {
              facts: false,
            },
          },
        },
      })

      await cmdManifestScala.run(['.'], importMeta, context)

      expect(mockConvertToFacts).not.toHaveBeenCalled()
      expect(mockConvertSbtToMaven).toHaveBeenCalled()
    })
  })
})
