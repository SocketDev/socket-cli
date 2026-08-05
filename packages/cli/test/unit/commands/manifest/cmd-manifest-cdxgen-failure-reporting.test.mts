/**
 * Unit tests for the cdxgen command's failure reporting.
 *
 * Purpose: The command arms process.exitCode = 1 before spawning cdxgen, and
 * cdxgen itself runs with stdio: 'inherit'. Together that means any path out
 * of the spawn that neither exits deliberately nor prints leaves the user with
 * exit code 1 and an empty log. These tests cover every one of those paths.
 *
 * Related Files: - src/commands/manifest/cmd-manifest-cdxgen.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdManifestCdxgen } from '../../../../src/commands/manifest/cmd-manifest-cdxgen.mts'
import { formatMissingCdxgenLocalPathMessage } from '../../../../src/util/dlx/cdxgen-diagnostics.mts'
import { InputError } from '../../../../src/util/error/errors-types.mts'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockDebugNs = vi.hoisted(() => vi.fn())

vi.mock(
  import('@socketsecurity/lib-stable/debug/output'),
  async importOriginal => ({
    ...(await importOriginal()),
    debugNs: mockDebugNs,
  }),
)

const mockRunCdxgen = vi.hoisted(() => vi.fn())
const mockDetectNodejsCdxgenSources = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ hasLockfile: true, hasNodeModules: true }),
)
const mockIsNodejsCdxgenType = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock(import('../../../../src/commands/manifest/run-cdxgen.mts'), () => ({
  detectNodejsCdxgenSources: mockDetectNodejsCdxgenSources,
  isNodejsCdxgenType: mockIsNodejsCdxgenType,
  runCdxgen: mockRunCdxgen,
}))

describe('cmd-manifest-cdxgen failure reporting', () => {
  const importMeta = { url: 'file:///test/cmd-manifest-cdxgen.mts' }
  const context = { parentName: 'socket manifest' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectNodejsCdxgenSources.mockResolvedValue({
      hasLockfile: true,
      hasNodeModules: true,
    })
    mockIsNodejsCdxgenType.mockReturnValue(true)
    process.exitCode = undefined
  })

  describe('never fails silently', () => {
    // The command arms process.exitCode = 1 before spawning cdxgen. Every
    // way out of the spawn must therefore either exit deliberately or print
    // something, otherwise the user gets exit code 1 and an empty log.
    it('reports an actionable error when cdxgen cannot be started', async () => {
      mockRunCdxgen.mockRejectedValue(new Error('spawn cdxgen ENOENT'))
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)

      await cmdManifestCdxgen.run(['.'], importMeta, context)

      expect(mockLogger.fail).toHaveBeenCalledTimes(1)
      const message = String(mockLogger.fail.mock.calls[0]?.[0] ?? '')
      expect(message.trim()).not.toBe('')
      expect(message).toContain('socket cdxgen could not run cdxgen.')
      expect(message).toContain('spawn cdxgen ENOENT')
      expect(process.exitCode).toBe(1)
      mockExit.mockRestore()
    })

    it('reports an actionable error when the spawn itself rejects', async () => {
      mockRunCdxgen.mockResolvedValue({
        spawnPromise: Promise.reject(new Error('cdxgen download failed')),
      })
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)

      await cmdManifestCdxgen.run(['.'], importMeta, context)

      expect(mockLogger.fail).toHaveBeenCalledTimes(1)
      const message = String(mockLogger.fail.mock.calls[0]?.[0] ?? '')
      expect(message).toContain('cdxgen download failed')
      expect(process.exitCode).toBe(1)
      mockExit.mockRestore()
    })

    it('reports an actionable error when cdxgen ends with no exit code and no signal', async () => {
      mockRunCdxgen.mockResolvedValue({
        spawnPromise: Promise.resolve({ code: undefined, signal: undefined }),
      })
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)

      await cmdManifestCdxgen.run(['.'], importMeta, context)

      expect(mockExit).not.toHaveBeenCalled()
      expect(mockLogger.fail).toHaveBeenCalledTimes(1)
      const message = String(mockLogger.fail.mock.calls[0]?.[0] ?? '')
      expect(message).toContain('without reporting an exit code or a signal')
      expect(process.exitCode).toBe(1)
      mockExit.mockRestore()
    })

    // The failure message tells the user to re-run with SOCKET_CLI_DEBUG=1.
    // That flag turns on the 'error' debug category, so the underlying detail
    // has to be emitted there or the advice sends them nowhere.
    it('makes SOCKET_CLI_DEBUG=1 worth running after a failed spawn', async () => {
      const cause = new Error('spawn cdxgen ENOENT')
      mockRunCdxgen.mockRejectedValue(cause)
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)

      await cmdManifestCdxgen.run(['.'], importMeta, context)

      const debugCall = mockDebugNs.mock.calls.find(call => call[0] === 'error')
      expect(debugCall).toBeDefined()
      expect(debugCall).toContain(cause)
      mockExit.mockRestore()
    })

    it('makes SOCKET_CLI_DEBUG=1 worth running after a resultless exit', async () => {
      const spawnResult = { code: undefined, signal: undefined }
      mockRunCdxgen.mockResolvedValue({
        spawnPromise: Promise.resolve(spawnResult),
      })
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)

      await cmdManifestCdxgen.run(['.'], importMeta, context)

      const debugCall = mockDebugNs.mock.calls.find(call => call[0] === 'error')
      expect(debugCall).toBeDefined()
      expect(debugCall).toContain(spawnResult)
      mockExit.mockRestore()
    })

    it('prints the missing-override message as written, without wrapping it', async () => {
      const explained = formatMissingCdxgenLocalPathMessage('/tmp/acme-cdxgen')
      mockRunCdxgen.mockRejectedValue(new InputError(explained))
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)

      await cmdManifestCdxgen.run(['.'], importMeta, context)

      expect(mockLogger.fail).toHaveBeenCalledTimes(1)
      const message = String(mockLogger.fail.mock.calls[0]?.[0] ?? '')
      expect(message).toBe(explained)
      expect(process.exitCode).toBe(1)
      mockExit.mockRestore()
    })

    it('stays quiet on the success path', async () => {
      mockRunCdxgen.mockResolvedValue({
        spawnPromise: Promise.resolve({ code: 0, signal: undefined }),
      })
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as unknown)

      await cmdManifestCdxgen.run(['.'], importMeta, context)

      expect(mockLogger.fail).not.toHaveBeenCalled()
      expect(mockExit).toHaveBeenCalledWith(0)
      mockExit.mockRestore()
    })
  })
})
