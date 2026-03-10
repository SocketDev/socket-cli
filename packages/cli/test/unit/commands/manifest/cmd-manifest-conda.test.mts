/**
 * Unit tests for manifest conda command.
 *
 * Tests the command that converts Conda environment.yml to requirements.txt.
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
  LOG_SYMBOLS: {
    success: '✓',
    fail: '✗',
  },
  getDefaultLogger: () => mockLogger,
}))

// Mock dependencies.
const mockHandleManifestConda = vi.hoisted(() => vi.fn())
const mockReadOrDefaultSocketJson = vi.hoisted(() => vi.fn().mockReturnValue({}))

vi.mock('../../../../src/commands/manifest/handle-manifest-conda.mts', () => ({
  handleManifestConda: mockHandleManifestConda,
}))

vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
}))

// Import after mocks.
const { cmdManifestConda } = await import(
  '../../../../src/commands/manifest/cmd-manifest-conda.mts'
)

describe('cmd-manifest-conda', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdManifestConda.description).toContain('Conda')
      expect(cmdManifestConda.description).toContain('environment.yml')
    })

    it('should not be hidden', () => {
      expect(cmdManifestConda.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest-conda.mts' }
    const context = { parentName: 'socket manifest' }

    it('should support --dry-run flag', async () => {
      await cmdManifestConda.run(['--dry-run'], importMeta, context)

      expect(mockHandleManifestConda).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should show warning about conda support', async () => {
      await cmdManifestConda.run(['--dry-run'], importMeta, context)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Conda'),
      )
    })

    it('should call handleManifestConda without dry-run', async () => {
      await cmdManifestConda.run([], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: 'environment.yml',
          out: 'requirements.txt',
          outputKind: 'text',
          verbose: false,
        }),
      )
    })

    it('should pass --file flag to handler', async () => {
      await cmdManifestConda.run(
        ['--file', 'custom-env.yml'],
        importMeta,
        context,
      )

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: 'custom-env.yml',
        }),
      )
    })

    it('should pass --out flag to handler', async () => {
      await cmdManifestConda.run(
        ['--out', 'custom-requirements.txt'],
        importMeta,
        context,
      )

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          out: 'custom-requirements.txt',
        }),
      )
    })

    it('should pass --verbose flag to handler', async () => {
      await cmdManifestConda.run(['--verbose'], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
        }),
      )
    })

    it('should use stdin when --stdin flag is set', async () => {
      await cmdManifestConda.run(['--stdin'], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: '-',
        }),
      )
    })

    it('should use stdout when --stdout flag is set', async () => {
      await cmdManifestConda.run(['--stdout'], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          out: '-',
        }),
      )
    })

    it('should support custom cwd argument', async () => {
      await cmdManifestConda.run(['./custom-dir'], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringContaining('custom-dir'),
        }),
      )
    })

    it('should fail with multiple directory arguments', async () => {
      await cmdManifestConda.run(['dir1', 'dir2'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleManifestConda).not.toHaveBeenCalled()
    })

    it('should fail when --json and --markdown are both set', async () => {
      await cmdManifestConda.run(['--json', '--markdown'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleManifestConda).not.toHaveBeenCalled()
    })

    it('should support --json output mode', async () => {
      await cmdManifestConda.run(['--json'], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      await cmdManifestConda.run(['--markdown'], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should use socket.json defaults for stdin', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            conda: {
              stdin: true,
            },
          },
        },
      })

      await cmdManifestConda.run([], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: '-',
        }),
      )
    })

    it('should use socket.json defaults for infile', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            conda: {
              infile: 'custom-default.yml',
            },
          },
        },
      })

      await cmdManifestConda.run([], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: 'custom-default.yml',
        }),
      )
    })

    it('should use socket.json defaults for stdout', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            conda: {
              stdout: true,
            },
          },
        },
      })

      await cmdManifestConda.run([], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          out: '-',
        }),
      )
    })

    it('should use socket.json defaults for outfile', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            conda: {
              outfile: 'custom-output.txt',
            },
          },
        },
      })

      await cmdManifestConda.run([], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          out: 'custom-output.txt',
        }),
      )
    })

    it('should use socket.json defaults for verbose', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            conda: {
              verbose: true,
            },
          },
        },
      })

      await cmdManifestConda.run([], importMeta, context)

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
        }),
      )
    })

    it('should override socket.json defaults with CLI flags', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          manifest: {
            conda: {
              infile: 'default.yml',
              outfile: 'default.txt',
              verbose: false,
            },
          },
        },
      })

      await cmdManifestConda.run(
        ['--file', 'cli.yml', '--out', 'cli.txt', '--verbose'],
        importMeta,
        context,
      )

      expect(mockHandleManifestConda).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: 'cli.yml',
          out: 'cli.txt',
          verbose: true,
        }),
      )
    })
  })
})
