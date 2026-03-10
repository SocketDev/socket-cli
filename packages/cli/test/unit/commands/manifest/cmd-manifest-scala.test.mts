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

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock convertSbtToMaven and outputManifest.
const mockConvertSbtToMaven = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, data: { files: [] } }),
)
const mockOutputManifest = vi.hoisted(() => vi.fn())
const mockReadOrDefaultSocketJson = vi.hoisted(() =>
  vi.fn().mockReturnValue({}),
)

vi.mock('../../../../src/commands/manifest/convert-sbt-to-maven.mts', () => ({
  convertSbtToMaven: mockConvertSbtToMaven,
}))

vi.mock('../../../../src/commands/manifest/output-manifest.mts', () => ({
  outputManifest: mockOutputManifest,
}))

vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
}))

// Import after mocks.
const { cmdManifestScala } =
  await import('../../../../src/commands/manifest/cmd-manifest-scala.mts')

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

    it('should call convertSbtToMaven with correct default parameters', async () => {
      await cmdManifestScala.run(['.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith({
        bin: 'sbt',
        cwd: expect.stringContaining('/'),
        out: './socket.pom.xml',
        outputKind: 'text',
        sbtOpts: [],
        verbose: false,
      })
    })

    it('should pass custom --bin flag to convertSbtToMaven', async () => {
      await cmdManifestScala.run(
        ['--bin', '/custom/sbt', '.'],
        importMeta,
        context,
      )

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: '/custom/sbt',
        }),
      )
    })

    it('should pass custom --out flag to convertSbtToMaven', async () => {
      await cmdManifestScala.run(
        ['--out', '/output/pom.xml', '.'],
        importMeta,
        context,
      )

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          out: '/output/pom.xml',
        }),
      )
    })

    it('should set out to - when --stdout flag is used', async () => {
      await cmdManifestScala.run(['--stdout', '.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          out: '-',
        }),
      )
    })

    it('should parse and pass --sbt-opts flag', async () => {
      // Use = syntax for values that look like flags.
      await cmdManifestScala.run(
        ['--sbt-opts=-batch -mem 2048', '.'],
        importMeta,
        context,
      )

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          sbtOpts: ['-batch', '-mem', '2048'],
        }),
      )
    })

    it('should pass --verbose flag to convertSbtToMaven', async () => {
      await cmdManifestScala.run(['--verbose', '.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
        }),
      )
    })

    it('should use socket.json defaults for bin', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            sbt: {
              bin: '/socket-json/sbt',
            },
          },
        },
      })

      await cmdManifestScala.run(['.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: '/socket-json/sbt',
        }),
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('--bin'),
        '/socket-json/sbt',
      )
    })

    it('should use socket.json defaults for outfile', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            sbt: {
              outfile: '/custom/output.xml',
            },
          },
        },
      })

      await cmdManifestScala.run(['.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          out: '/custom/output.xml',
        }),
      )
    })

    it('should use socket.json defaults for stdout', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            sbt: {
              stdout: true,
            },
          },
        },
      })

      await cmdManifestScala.run(['.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          out: '-',
        }),
      )
    })

    it('should use socket.json defaults for sbtOpts', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            sbt: {
              sbtOpts: '-J-Xmx4G -batch',
            },
          },
        },
      })

      await cmdManifestScala.run(['.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          sbtOpts: ['-J-Xmx4G', '-batch'],
        }),
      )
    })

    it('should use socket.json defaults for verbose', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            sbt: {
              verbose: true,
            },
          },
        },
      })

      await cmdManifestScala.run(['.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
        }),
      )
    })

    it('should reject multiple directory arguments', async () => {
      await cmdManifestScala.run(['dir1', 'dir2'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockConvertSbtToMaven).not.toHaveBeenCalled()
    })

    it('should output manifest in json mode', async () => {
      const result = { ok: true, data: { files: ['pom.xml'] } }
      mockConvertSbtToMaven.mockResolvedValueOnce(result)

      await cmdManifestScala.run(['--json', '.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
      expect(mockOutputManifest).toHaveBeenCalledWith(
        result,
        'json',
        './socket.pom.xml',
      )
    })

    it('should output manifest in markdown mode', async () => {
      const result = { ok: true, data: { files: [] } }
      mockConvertSbtToMaven.mockResolvedValueOnce(result)

      await cmdManifestScala.run(['--markdown', '.'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
      expect(mockOutputManifest).toHaveBeenCalledWith(
        result,
        'markdown',
        './socket.pom.xml',
      )
    })

    it('should not call outputManifest in text mode', async () => {
      await cmdManifestScala.run(['.'], importMeta, context)

      expect(mockOutputManifest).not.toHaveBeenCalled()
    })

    it('should resolve cwd to absolute path', async () => {
      await cmdManifestScala.run(['./relative'], importMeta, context)

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringMatching(/^\/.*relative$/),
        }),
      )
    })

    it('should override socket.json defaults with CLI flags', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            sbt: {
              bin: '/socket-json/sbt',
              out: '/socket-json/out.xml',
              verbose: false,
            },
          },
        },
      })

      await cmdManifestScala.run(
        ['--bin', '/cli/sbt', '--out', '/cli/out.xml', '--verbose', '.'],
        importMeta,
        context,
      )

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          bin: '/cli/sbt',
          out: '/cli/out.xml',
          verbose: true,
        }),
      )
    })

    it('should prefer --stdout over --out', async () => {
      await cmdManifestScala.run(
        ['--out', '/some/file.xml', '--stdout', '.'],
        importMeta,
        context,
      )

      expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
        expect.objectContaining({
          out: '-',
        }),
      )
    })
  })
})
