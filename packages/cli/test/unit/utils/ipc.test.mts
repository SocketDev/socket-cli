/**
 * Unit tests for IPC data handling.
 *
 * Purpose:
 * Tests the IPC data handling for subprocess communication.
 *
 * Test Coverage:
 * - getIpcExtra function
 * - getBootstrapBinaryPath function
 * - initializeIpc function
 *
 * Related Files:
 * - src/utils/ipc.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the boot module.
const mockWaitForBootstrapHandshake = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/sea/boot.mjs', () => ({
  waitForBootstrapHandshake: mockWaitForBootstrapHandshake,
}))

// We need to reset module state between tests since ipc.mts uses module-level variables.
// Import fresh for each test.
describe('IPC utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockWaitForBootstrapHandshake.mockResolvedValue(undefined)
  })

  describe('getIpcExtra', () => {
    it('returns undefined before initialization', async () => {
      const { getIpcExtra } = await import('../../../src/utils/ipc.mts')

      expect(getIpcExtra()).toBeUndefined()
    })

    it('returns IPC data after initialization with handshake', async () => {
      mockWaitForBootstrapHandshake.mockResolvedValue({
        extra: {
          SOCKET_CLI_FIX: 'auto',
          SOCKET_CLI_OPTIMIZE: true,
        },
      })

      const { getIpcExtra, initializeIpc } = await import(
        '../../../src/utils/ipc.mts'
      )

      await initializeIpc()

      const extra = getIpcExtra()
      expect(extra).toBeDefined()
      expect(extra?.SOCKET_CLI_FIX).toBe('auto')
      expect(extra?.SOCKET_CLI_OPTIMIZE).toBe(true)
    })
  })

  describe('getBootstrapBinaryPath', () => {
    it('returns undefined before initialization', async () => {
      const { getBootstrapBinaryPath } = await import(
        '../../../src/utils/ipc.mts'
      )

      expect(getBootstrapBinaryPath()).toBeUndefined()
    })

    it('returns path after initialization with handshake', async () => {
      mockWaitForBootstrapHandshake.mockResolvedValue({
        extra: {
          bootstrapBinaryPath: '/usr/local/bin/socket',
        },
      })

      const { getBootstrapBinaryPath, initializeIpc } = await import(
        '../../../src/utils/ipc.mts'
      )

      await initializeIpc()

      expect(getBootstrapBinaryPath()).toBe('/usr/local/bin/socket')
    })
  })

  describe('initializeIpc', () => {
    it('handles missing handshake gracefully', async () => {
      mockWaitForBootstrapHandshake.mockResolvedValue(undefined)

      const { getIpcExtra, initializeIpc } = await import(
        '../../../src/utils/ipc.mts'
      )

      // Should not throw.
      await expect(initializeIpc()).resolves.not.toThrow()

      expect(getIpcExtra()).toBeUndefined()
    })

    it('handles handshake timeout gracefully', async () => {
      mockWaitForBootstrapHandshake.mockRejectedValue(new Error('Timeout'))

      const { getIpcExtra, initializeIpc } = await import(
        '../../../src/utils/ipc.mts'
      )

      // Should not throw.
      await expect(initializeIpc()).resolves.not.toThrow()

      expect(getIpcExtra()).toBeUndefined()
    })

    it('handles handshake without extra field', async () => {
      mockWaitForBootstrapHandshake.mockResolvedValue({
        type: 'handshake',
        data: {},
      })

      const { getIpcExtra, initializeIpc } = await import(
        '../../../src/utils/ipc.mts'
      )

      await initializeIpc()

      expect(getIpcExtra()).toBeUndefined()
    })

    it('extracts bootstrap binary path from extra', async () => {
      mockWaitForBootstrapHandshake.mockResolvedValue({
        extra: {
          bootstrapBinaryPath: '/path/to/socket',
          SOCKET_CLI_FIX: 'auto',
        },
      })

      const { getBootstrapBinaryPath, getIpcExtra, initializeIpc } =
        await import('../../../src/utils/ipc.mts')

      await initializeIpc()

      expect(getBootstrapBinaryPath()).toBe('/path/to/socket')
      // bootstrapBinaryPath should be excluded from ipcExtra.
      const extra = getIpcExtra()
      expect(extra).toBeDefined()
      expect('bootstrapBinaryPath' in (extra ?? {})).toBe(false)
      expect(extra?.SOCKET_CLI_FIX).toBe('auto')
    })

    it('ignores non-string bootstrap binary path', async () => {
      mockWaitForBootstrapHandshake.mockResolvedValue({
        extra: {
          bootstrapBinaryPath: 123, // Invalid type.
          SOCKET_CLI_FIX: 'auto',
        },
      })

      const { getBootstrapBinaryPath, initializeIpc } = await import(
        '../../../src/utils/ipc.mts'
      )

      await initializeIpc()

      expect(getBootstrapBinaryPath()).toBeUndefined()
    })
  })
})
