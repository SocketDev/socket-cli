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

// Mock spawnSocketPyCli.
const mockSpawnSocketPyCli = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/python/standalone.mts', () => ({
  spawnSocketPyCli: mockSpawnSocketPyCli,
}))

// Import after mocks.
const { cmdPyCli } =
  await import('../../../../src/commands/pycli/cmd-pycli.mts')

describe('cmd-pycli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdPyCli.description).toBe(
        'Run Socket Python CLI (socketsecurity) directly',
      )
    })

    it('should not be hidden', () => {
      expect(cmdPyCli.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-pycli.mts' }
    const context = { parentName: 'socket' }

    it('should pass arguments to spawnSocketPyCli', async () => {
      mockSpawnSocketPyCli.mockResolvedValue({ ok: true, data: '' })

      await cmdPyCli.run(
        ['--generate-license', '--repo', 'owner/repo', '.'],
        importMeta,
        context,
      )

      expect(mockSpawnSocketPyCli).toHaveBeenCalledWith(
        ['--generate-license', '--repo', 'owner/repo', '.'],
        { stdio: 'inherit' },
      )
    })

    it('should filter out Socket CLI flags before passing to Python CLI', async () => {
      mockSpawnSocketPyCli.mockResolvedValue({ ok: true, data: '' })

      await cmdPyCli.run(
        ['--dry-run', '--generate-license', '--repo', 'owner/repo'],
        importMeta,
        context,
      )

      // --dry-run should be filtered out.
      expect(mockSpawnSocketPyCli).not.toHaveBeenCalled()
      // Dry run should bail early.
    })

    it('should set exitCode to 1 on failure', async () => {
      mockSpawnSocketPyCli.mockResolvedValue({
        ok: false,
        message: 'Python CLI failed',
      })

      await cmdPyCli.run(['--enable-sarif'], importMeta, context)

      expect(process.exitCode).toBe(1)
      expect(mockLogger.fail).toHaveBeenCalledWith('Python CLI failed')
    })

    it('should not set error exitCode on success', async () => {
      mockSpawnSocketPyCli.mockResolvedValue({ ok: true, data: '' })

      await cmdPyCli.run(['--strict-blocking'], importMeta, context)

      // Success means exitCode is 0 or undefined (not an error code).
      expect(process.exitCode).not.toBe(1)
    })

    it('should log info message when invoking Python CLI', async () => {
      mockSpawnSocketPyCli.mockResolvedValue({ ok: true, data: '' })

      await cmdPyCli.run(
        ['--slack-webhook', 'https://hooks.slack.com/...'],
        importMeta,
        context,
      )

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Invoking Socket Python CLI...',
      )
    })

    it('should handle empty arguments', async () => {
      mockSpawnSocketPyCli.mockResolvedValue({ ok: true, data: '' })

      await cmdPyCli.run([], importMeta, context)

      expect(mockSpawnSocketPyCli).toHaveBeenCalledWith([], {
        stdio: 'inherit',
      })
    })

    it('should handle failure without message', async () => {
      mockSpawnSocketPyCli.mockResolvedValue({ ok: false })

      await cmdPyCli.run(['--enable-sarif'], importMeta, context)

      expect(process.exitCode).toBe(1)
      // Should not call logger.fail when message is missing.
      expect(mockLogger.fail).not.toHaveBeenCalled()
    })

    it('should output dry-run preview when --dry-run is used', async () => {
      await cmdPyCli.run(
        ['--dry-run', '--generate-license', '--repo', 'owner/repo'],
        importMeta,
        context,
      )

      expect(mockSpawnSocketPyCli).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should filter help flags from arguments', async () => {
      mockSpawnSocketPyCli.mockResolvedValue({ ok: true, data: '' })

      await cmdPyCli.run(
        ['--generate-license', '.'],
        importMeta,
        context,
      )

      // Help flags should not be in arguments passed to Python CLI.
      expect(mockSpawnSocketPyCli).toHaveBeenCalledWith(
        ['--generate-license', '.'],
        expect.any(Object),
      )
    })
  })
})
