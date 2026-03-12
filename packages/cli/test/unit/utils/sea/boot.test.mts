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
})
