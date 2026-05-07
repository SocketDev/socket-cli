/**
 * Unit tests for SEA bootstrap utilities.
 *
 * Purpose:
 * Tests SEA (Single Executable Application) bootstrap functionality.
 * Validates subprocess detection and spawn option preparation.
 *
 * Test Coverage:
 * - isSubprocess detection
 * - shouldBypassBootstrap logic
 * - getBootstrapExecPath path selection
 * - prepareBootstrapSpawnOptions option handling
 * - sendBootstrapHandshake IPC messaging
 *
 * Related Files:
 * - utils/sea/boot.mts (implementation)
 * - utils/sea/detect.mts (SEA detection)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
vi.mock('../../../../src/utils/sea/detect.mts', () => ({
  isSeaBinary: vi.fn(),
}))

import { SOCKET_IPC_HANDSHAKE } from '@socketsecurity/lib/constants/socket'

import { isSeaBinary } from '../../../../src/utils/sea/detect.mts'
import {
  getBootstrapExecPath,
  isSubprocess,
  prepareBootstrapSpawnOptions,
  sendBootstrapHandshake,
  shouldBypassBootstrap,
} from '../../../../src/utils/sea/boot.mts'

describe('sea/boot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isSubprocess', () => {
    it('returns false when process.channel is undefined', () => {
      // Default state has no channel.
      expect(isSubprocess()).toBe(false)
    })
  })

  describe('shouldBypassBootstrap', () => {
    it('returns true when not a SEA binary', () => {
      vi.mocked(isSeaBinary).mockReturnValue(false)

      expect(shouldBypassBootstrap()).toBe(true)
    })

    it('returns false when SEA binary without IPC channel', () => {
      vi.mocked(isSeaBinary).mockReturnValue(true)

      // No IPC channel, should not bypass.
      expect(shouldBypassBootstrap()).toBe(false)
    })
  })

  describe('getBootstrapExecPath', () => {
    it('returns process.execPath when not a SEA binary', () => {
      vi.mocked(isSeaBinary).mockReturnValue(false)

      const path = getBootstrapExecPath()

      expect(path).toBe(process.execPath)
    })

    it('returns process.execPath for SEA binary when system Node not found', () => {
      vi.mocked(isSeaBinary).mockReturnValue(true)

      // findSystemNodejs returns undefined, so falls back to execPath.
      const path = getBootstrapExecPath(true)

      expect(path).toBe(process.execPath)
    })

    it('returns process.execPath for SEA binary when preferSystemNode is false', () => {
      vi.mocked(isSeaBinary).mockReturnValue(true)

      const path = getBootstrapExecPath(false)

      expect(path).toBe(process.execPath)
    })
  })

  describe('prepareBootstrapSpawnOptions', () => {
    it('returns copy of options when not SEA binary', () => {
      vi.mocked(isSeaBinary).mockReturnValue(false)

      const inputOptions = { cwd: '/test', shell: false }
      const result = prepareBootstrapSpawnOptions(inputOptions)

      expect(result).toEqual(inputOptions)
      expect(result).not.toBe(inputOptions)
    })

    it('returns copy of options for SEA binary', () => {
      vi.mocked(isSeaBinary).mockReturnValue(true)

      const inputOptions = { cwd: '/test', shell: false }
      const result = prepareBootstrapSpawnOptions(inputOptions)

      expect(result).toEqual(inputOptions)
    })

    it('handles undefined options', () => {
      vi.mocked(isSeaBinary).mockReturnValue(false)

      const result = prepareBootstrapSpawnOptions(undefined)

      expect(result).toEqual({})
    })

    it('handles IPC data parameter', () => {
      vi.mocked(isSeaBinary).mockReturnValue(true)

      const inputOptions = { cwd: '/test' }
      const ipcData = { subprocess: true, parent_pid: 12345 }
      const result = prepareBootstrapSpawnOptions(inputOptions, ipcData)

      expect(result.cwd).toBe('/test')
    })
  })

  describe('sendBootstrapHandshake', () => {
    it('sends IPC handshake message with correct format', () => {
      const mockSend = vi.fn()
      const childProcess = { send: mockSend }
      const ipcData = { subprocess: true, parent_pid: 12345 }

      sendBootstrapHandshake(childProcess, ipcData)

      expect(mockSend).toHaveBeenCalledTimes(1)
      const sentMessage = mockSend.mock.calls[0]![0]
      expect(sentMessage).toHaveProperty(SOCKET_IPC_HANDSHAKE)
      expect(sentMessage[SOCKET_IPC_HANDSHAKE]).toEqual(ipcData)
    })

    it('sends custom IPC data', () => {
      const mockSend = vi.fn()
      const childProcess = { send: mockSend }
      const ipcData = {
        subprocess: true,
        parent_pid: 99999,
        custom: 'data',
        nested: { key: 'value' },
      }

      sendBootstrapHandshake(childProcess, ipcData)

      const sentMessage = mockSend.mock.calls[0]![0]
      expect(sentMessage[SOCKET_IPC_HANDSHAKE]).toEqual(ipcData)
    })
  })

  describe('waitForBootstrapHandshake', () => {
    it('resolves with undefined when no IPC channel exists', async () => {
      // Import fresh module to test default behavior.
      const { waitForBootstrapHandshake } = await import(
        '../../../../src/utils/sea/boot.mts'
      )

      // No IPC channel, should resolve immediately with undefined.
      const result = await waitForBootstrapHandshake(100)
      expect(result).toBeUndefined()
    })

    it('resolves with handshake data when message arrives', async () => {
      // Stub process.channel + .on/.off so isSubprocess() reports true.
      const handlers: Record<string, ((m: unknown) => void)[]> = {}
      const fakeOn = vi.fn(
        (event: string, handler: (m: unknown) => void) => {
          ;(handlers[event] ??= []).push(handler)
        },
      )
      const fakeOff = vi.fn(
        (event: string, handler: (m: unknown) => void) => {
          handlers[event] = (handlers[event] ?? []).filter(h => h !== handler)
        },
      )
      const originalChannel = process.channel
      const originalOn = process.on
      const originalOff = process.off

      Object.defineProperty(process, 'channel', {
        value: {} as any,
        writable: true,
        configurable: true,
      })
      ;(process as any).on = fakeOn
      ;(process as any).off = fakeOff

      try {
        const { waitForBootstrapHandshake } = await import(
          '../../../../src/utils/sea/boot.mts'
        )
        const promise = waitForBootstrapHandshake(500)
        // Schedule the message after the handler is registered.
        await new Promise(resolve => setImmediate(resolve))
        const msg = {
          [SOCKET_IPC_HANDSHAKE]: { subprocess: true, parent_pid: 12345 },
        }
        for (const handler of handlers['message'] ?? []) {
          handler(msg)
        }
        const result = await promise
        expect(result).toEqual({ subprocess: true, parent_pid: 12345 })
      } finally {
        Object.defineProperty(process, 'channel', {
          value: originalChannel,
          writable: true,
          configurable: true,
        })
        ;(process as any).on = originalOn
        ;(process as any).off = originalOff
      }
    })

    it('rejects on timeout when no message arrives', async () => {
      const fakeOn = vi.fn()
      const fakeOff = vi.fn()
      const originalChannel = process.channel
      const originalOn = process.on
      const originalOff = process.off

      Object.defineProperty(process, 'channel', {
        value: {} as any,
        writable: true,
        configurable: true,
      })
      ;(process as any).on = fakeOn
      ;(process as any).off = fakeOff

      try {
        const { waitForBootstrapHandshake } = await import(
          '../../../../src/utils/sea/boot.mts'
        )
        await expect(waitForBootstrapHandshake(50)).rejects.toThrow(
          /timeout/,
        )
      } finally {
        Object.defineProperty(process, 'channel', {
          value: originalChannel,
          writable: true,
          configurable: true,
        })
        ;(process as any).on = originalOn
        ;(process as any).off = originalOff
      }
    })

    it('ignores non-handshake messages', async () => {
      const handlers: Record<string, ((m: unknown) => void)[]> = {}
      const fakeOn = vi.fn(
        (event: string, handler: (m: unknown) => void) => {
          ;(handlers[event] ??= []).push(handler)
        },
      )
      const fakeOff = vi.fn()
      const originalChannel = process.channel
      const originalOn = process.on
      const originalOff = process.off

      Object.defineProperty(process, 'channel', {
        value: {} as any,
        writable: true,
        configurable: true,
      })
      ;(process as any).on = fakeOn
      ;(process as any).off = fakeOff

      try {
        const { waitForBootstrapHandshake } = await import(
          '../../../../src/utils/sea/boot.mts'
        )
        const promise = waitForBootstrapHandshake(50)
        await new Promise(resolve => setImmediate(resolve))
        // Send a few non-handshake messages to exercise early-returns.
        for (const handler of handlers['message'] ?? []) {
          handler(null)
          handler('string')
          handler({ unrelated: true })
          handler({ [SOCKET_IPC_HANDSHAKE]: 'not-an-object' })
          handler({ [SOCKET_IPC_HANDSHAKE]: { subprocess: false } })
        }
        await expect(promise).rejects.toThrow(/timeout/)
      } finally {
        Object.defineProperty(process, 'channel', {
          value: originalChannel,
          writable: true,
          configurable: true,
        })
        ;(process as any).on = originalOn
        ;(process as any).off = originalOff
      }
    })
  })
})
