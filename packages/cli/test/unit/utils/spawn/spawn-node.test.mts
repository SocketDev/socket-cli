/**
 * Unit tests for spawn-node utilities.
 *
 * Purpose:
 * Tests the Node.js spawn abstraction with SEA bootstrap handling.
 *
 * Test Coverage:
 * - ensureIpcInStdio function
 * - findSystemNodejsSync function
 * - getNodeExecutablePathSync function
 *
 * Related Files:
 * - utils/spawn/spawn-node.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockWhichRealSync = vi.hoisted(() => vi.fn())
const mockGetExecPath = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpawnSync = vi.hoisted(() => vi.fn())
const mockIsSeaBinary = vi.hoisted(() => vi.fn())
const mockSendBootstrapHandshake = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/bin', () => ({
  whichRealSync: mockWhichRealSync,
}))

vi.mock('@socketsecurity/lib/constants/node', () => ({
  getExecPath: mockGetExecPath,
}))

vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}))

vi.mock('../../../../src/utils/sea/detect.mjs', () => ({
  isSeaBinary: mockIsSeaBinary,
}))

vi.mock('../../../../src/utils/sea/boot.mjs', () => ({
  sendBootstrapHandshake: mockSendBootstrapHandshake,
}))

import {
  findSystemNodejsSync,
  getNodeExecutablePathSync,
  spawnNode,
  spawnNodeSync,
} from '../../../../src/utils/spawn/spawn-node.mts'

describe('spawn-node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetExecPath.mockReturnValue('/usr/local/bin/node')
    mockIsSeaBinary.mockReturnValue(false)
    mockSpawn.mockReturnValue({ process: { send: vi.fn() } })
  })

  describe('findSystemNodejsSync', () => {
    it('returns undefined when no node found', () => {
      mockWhichRealSync.mockReturnValue(null)

      const result = findSystemNodejsSync()

      expect(result).toBeUndefined()
    })

    it('returns single node path when found', () => {
      mockWhichRealSync.mockReturnValue('/usr/bin/node')

      const result = findSystemNodejsSync()

      expect(result).toBe('/usr/bin/node')
    })

    it('returns first non-current-exec path when multiple found', () => {
      mockWhichRealSync.mockReturnValue(['/usr/bin/node', '/usr/local/bin/node'])
      // Mock process.execPath.
      const originalExecPath = process.execPath
      Object.defineProperty(process, 'execPath', {
        value: '/usr/bin/node',
        writable: true,
      })

      const result = findSystemNodejsSync()

      Object.defineProperty(process, 'execPath', {
        value: originalExecPath,
        writable: true,
      })

      expect(result).toBe('/usr/local/bin/node')
    })

    it('filters out current execPath from results', () => {
      const originalExecPath = process.execPath
      Object.defineProperty(process, 'execPath', {
        value: '/my/sea/binary',
        writable: true,
      })

      mockWhichRealSync.mockReturnValue(['/my/sea/binary', '/usr/bin/node'])

      const result = findSystemNodejsSync()

      Object.defineProperty(process, 'execPath', {
        value: originalExecPath,
        writable: true,
      })

      expect(result).toBe('/usr/bin/node')
    })
  })

  describe('getNodeExecutablePathSync', () => {
    it('returns getExecPath when not a SEA binary', () => {
      mockIsSeaBinary.mockReturnValue(false)
      mockGetExecPath.mockReturnValue('/usr/local/bin/node')

      const result = getNodeExecutablePathSync()

      expect(result).toBe('/usr/local/bin/node')
      expect(mockGetExecPath).toHaveBeenCalled()
    })

    it('returns system node when SEA and system node available', () => {
      mockIsSeaBinary.mockReturnValue(true)
      mockWhichRealSync.mockReturnValue('/usr/bin/node')

      const result = getNodeExecutablePathSync()

      expect(result).toBe('/usr/bin/node')
    })

    it('returns process.execPath when SEA and no system node', () => {
      mockIsSeaBinary.mockReturnValue(true)
      mockWhichRealSync.mockReturnValue(null)

      const result = getNodeExecutablePathSync()

      expect(result).toBe(process.execPath)
    })
  })

  describe('spawnNode', () => {
    it('spawns node with IPC stdio', () => {
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      spawnNode(['script.js'])

      expect(mockSpawn).toHaveBeenCalled()
      const spawnCall = mockSpawn.mock.calls[0]
      expect(spawnCall[2].stdio).toContain('ipc')
    })

    it('sends bootstrap handshake after spawn', () => {
      const mockProcess = { send: vi.fn() }
      mockSpawn.mockReturnValue({ process: mockProcess })

      spawnNode(['script.js'])

      expect(mockSendBootstrapHandshake).toHaveBeenCalledWith(
        mockProcess,
        expect.objectContaining({
          subprocess: true,
          parent_pid: process.pid,
        }),
      )
    })

    it('includes custom IPC data in handshake extra field', () => {
      const mockProcess = { send: vi.fn() }
      mockSpawn.mockReturnValue({ process: mockProcess })

      spawnNode(['script.js'], { ipc: { custom: 'data' } })

      expect(mockSendBootstrapHandshake).toHaveBeenCalledWith(
        mockProcess,
        expect.objectContaining({
          extra: { custom: 'data' },
        }),
      )
    })

    it('preserves existing stdio array', () => {
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      spawnNode(['script.js'], { stdio: ['pipe', 'pipe', 'pipe'] })

      const spawnCall = mockSpawn.mock.calls[0]
      expect(spawnCall[2].stdio).toEqual(['pipe', 'pipe', 'pipe', 'ipc'])
    })

    it('converts string stdio to array with ipc', () => {
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      spawnNode(['script.js'], { stdio: 'inherit' })

      const spawnCall = mockSpawn.mock.calls[0]
      expect(spawnCall[2].stdio).toEqual(['inherit', 'inherit', 'inherit', 'ipc'])
    })
  })

  describe('spawnNodeSync', () => {
    it('spawns node synchronously', () => {
      mockSpawnSync.mockReturnValue({ status: 0 })

      const result = spawnNodeSync(['script.js'])

      expect(mockSpawnSync).toHaveBeenCalled()
      expect(result.status).toBe(0)
    })
  })
})
