/**
 * Unit tests for patch command.
 *
 * Tests the command that manages CVE patches for dependencies.
 * This command forwards subcommands to socket-patch via DLX.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock spawnSocketPatchDlx.
const mockSpawnSocketPatchDlx = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    spawnPromise: Promise.resolve({ code: 0, signal: null }),
  }),
)

vi.mock('../../../../src/utils/dlx/spawn.mjs', () => ({
  spawnSocketPatchDlx: mockSpawnSocketPatchDlx,
}))

// Import after mocks.
const { cmdPatch } = await import(
  '../../../../src/commands/patch/cmd-patch.mts'
)

describe('cmd-patch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdPatch.description).toBe('Manage CVE patches for dependencies')
    })

    it('should not be hidden', () => {
      expect(cmdPatch.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-patch.mts' }
    const context = { parentName: 'socket' }

    it('should forward list subcommand to socket-patch', async () => {
      await cmdPatch.run(['list'], importMeta, context)

      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['list'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should forward get subcommand to socket-patch', async () => {
      await cmdPatch.run(['get', 'lodash'], importMeta, context)

      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['get', 'lodash'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should forward apply subcommand to socket-patch', async () => {
      await cmdPatch.run(['apply'], importMeta, context)

      expect(mockSpawnSocketPatchDlx).toHaveBeenCalledWith(
        ['apply'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('should set exit code from socket-patch result', async () => {
      mockSpawnSocketPatchDlx.mockResolvedValueOnce({
        spawnPromise: Promise.resolve({ code: 0, signal: null }),
      })

      await cmdPatch.run(['list'], importMeta, context)

      expect(process.exitCode).toBe(0)
    })

    it('should propagate non-zero exit code from socket-patch', async () => {
      mockSpawnSocketPatchDlx.mockResolvedValueOnce({
        spawnPromise: Promise.resolve({ code: 1, signal: null }),
      })

      await cmdPatch.run(['list'], importMeta, context)

      expect(process.exitCode).toBe(1)
    })
  })
})
