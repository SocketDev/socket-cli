/**
 * Unit tests for spawn-node utilities.
 *
 * Purpose: Tests the Node.js spawn abstraction with SEA bootstrap handling, and
 * the trusted PATH lookup a SEA build uses to find a system interpreter.
 *
 * Test Coverage: - ensureIpcInStdio function - findSystemNodejs function -
 * resolveNodeExecutable function - spawnNode function.
 *
 * Related Files: - util/spawn/spawn-node.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockFindSystemTool = vi.hoisted(() => vi.fn())
const mockGetExecPath = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpawnSync = vi.hoisted(() => vi.fn())
const mockIsSeaBinary = vi.hoisted(() => vi.fn())
const mockSendBootstrapHandshake = vi.hoisted(() => vi.fn())

vi.mock(
  import('../../../../src/util/spawn/system-tool.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    findSystemTool: mockFindSystemTool,
  }),
)

vi.mock(import('@socketsecurity/lib-stable/constants/node'), () => ({
  getExecPath: mockGetExecPath,
}))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}))

vi.mock(import('../../../../src/util/sea/detect.mjs'), () => ({
  isSeaBinary: mockIsSeaBinary,
}))

vi.mock(import('../../../../src/util/sea/boot.mjs'), () => ({
  sendBootstrapHandshake: mockSendBootstrapHandshake,
}))

import {
  findSystemNodejs,
  resolveNodeExecutable,
  spawnNode,
} from '../../../../src/util/spawn/spawn-node.mts'

const SAFE_PATH = '/usr/bin:/bin'

/**
 * Swap `process.execPath` for the duration of `run`, so the SEA-binary branch
 * is exercisable without building one.
 */
async function withExecPath(
  execPath: string,
  run: () => Promise<void>,
): Promise<void> {
  const original = process.execPath
  Object.defineProperty(process, 'execPath', {
    value: execPath,
    writable: true,
  })
  try {
    await run()
  } finally {
    Object.defineProperty(process, 'execPath', {
      value: original,
      writable: true,
    })
  }
}

describe('spawn-node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetExecPath.mockReturnValue('/usr/local/bin/node')
    mockIsSeaBinary.mockReturnValue(false)
    mockSpawn.mockReturnValue({ process: { send: vi.fn() } })
    mockFindSystemTool.mockResolvedValue({
      executable: '/usr/bin/node',
      searchPath: SAFE_PATH,
    })
  })

  describe('findSystemNodejs', () => {
    it('returns undefined when no trusted node resolves', async () => {
      mockFindSystemTool.mockResolvedValue(undefined)

      expect(await findSystemNodejs()).toBeUndefined()
    })

    it('returns the trusted node and its sanitized search path', async () => {
      expect(await findSystemNodejs()).toStrictEqual({
        executable: '/usr/bin/node',
        searchPath: SAFE_PATH,
      })
    })

    it('resolves node through the trusted lookup, never a bare name', async () => {
      await findSystemNodejs({ cwd: '/checkout' })

      expect(mockFindSystemTool).toHaveBeenCalledWith('node', {
        cwd: '/checkout',
      })
    })

    it('rejects a winner that is this process own executable', async () => {
      await withExecPath('/my/sea/binary', async () => {
        mockFindSystemTool.mockResolvedValue({
          executable: '/my/sea/binary',
          searchPath: SAFE_PATH,
        })

        expect(await findSystemNodejs()).toBeUndefined()
      })
    })
  })

  describe('resolveNodeExecutable', () => {
    it('returns getExecPath and no search path when not a SEA binary', async () => {
      mockIsSeaBinary.mockReturnValue(false)
      mockGetExecPath.mockReturnValue('/usr/local/bin/node')

      expect(await resolveNodeExecutable()).toStrictEqual({
        executable: '/usr/local/bin/node',
        searchPath: undefined,
      })
      expect(mockFindSystemTool).not.toHaveBeenCalled()
    })

    it('returns the trusted system node when SEA and one resolves', async () => {
      mockIsSeaBinary.mockReturnValue(true)

      expect(await resolveNodeExecutable()).toStrictEqual({
        executable: '/usr/bin/node',
        searchPath: SAFE_PATH,
      })
    })

    it('falls back to the SEA binary when no trusted node resolves', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      mockFindSystemTool.mockResolvedValue(undefined)

      expect(await resolveNodeExecutable()).toStrictEqual({
        executable: process.execPath,
        searchPath: undefined,
      })
    })
  })

  describe('spawnNode', () => {
    it('spawns node with IPC stdio', async () => {
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      await spawnNode(['script.js'])

      expect(mockSpawn).toHaveBeenCalled()
      const spawnCall = mockSpawn.mock.calls[0]
      expect(spawnCall[2].stdio).toContain('ipc')
    })

    it('sends bootstrap handshake after spawn', async () => {
      const mockProcess = { send: vi.fn() }
      mockSpawn.mockReturnValue({ process: mockProcess })

      await spawnNode(['script.js'])

      expect(mockSendBootstrapHandshake).toHaveBeenCalledWith(
        mockProcess,
        expect.objectContaining({
          subprocess: true,
          parent_pid: process.pid,
        }),
      )
    })

    it('includes custom IPC data in handshake extra field', async () => {
      const mockProcess = { send: vi.fn() }
      mockSpawn.mockReturnValue({ process: mockProcess })

      await spawnNode(['script.js'], { ipc: { custom: 'data' } })

      expect(mockSendBootstrapHandshake).toHaveBeenCalledWith(
        mockProcess,
        expect.objectContaining({
          extra: { custom: 'data' },
        }),
      )
    })

    it('preserves existing stdio array', async () => {
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      await spawnNode(['script.js'], { stdio: ['pipe', 'pipe', 'pipe'] })

      const spawnCall = mockSpawn.mock.calls[0]
      expect(spawnCall[2].stdio).toEqual(['pipe', 'pipe', 'pipe', 'ipc'])
    })

    it('converts string stdio to array with ipc', async () => {
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      await spawnNode(['script.js'], { stdio: 'inherit' })

      const spawnCall = mockSpawn.mock.calls[0]
      expect(spawnCall[2].stdio).toEqual([
        'inherit',
        'inherit',
        'inherit',
        'ipc',
      ])
    })

    it('keeps stdio array unchanged when ipc is already present', async () => {
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      await spawnNode(['script.js'], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      })

      const spawnCall = mockSpawn.mock.calls[0]
      expect(spawnCall[2].stdio).toEqual(['pipe', 'pipe', 'pipe', 'ipc'])
    })

    it('spawns the trusted interpreter under SEA, never the bare name', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      await spawnNode(['script.js'])

      expect(mockSpawn.mock.calls[0][0]).toBe('/usr/bin/node')
    })

    it('hands the child the sanitized PATH under SEA', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      await spawnNode(['script.js'], {
        env: { HOME: '/home/user', PATH: '/checkout/bin:/usr/bin' },
      })

      const spawnCall = mockSpawn.mock.calls[0]
      expect(spawnCall[2].env).toStrictEqual({
        HOME: '/home/user',
        PATH: SAFE_PATH,
      })
    })

    it('leaves the caller env alone when no PATH lookup happened', async () => {
      mockIsSeaBinary.mockReturnValue(false)
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      await spawnNode(['script.js'], { env: { PATH: '/checkout/bin' } })

      const spawnCall = mockSpawn.mock.calls[0]
      expect(spawnCall[2].env).toStrictEqual({ PATH: '/checkout/bin' })
    })

    it('protects the checkout the child will run in', async () => {
      mockIsSeaBinary.mockReturnValue(true)
      mockSpawn.mockReturnValue({ process: { send: vi.fn() } })

      await spawnNode(['script.js'], { cwd: '/checkout' })

      expect(mockFindSystemTool).toHaveBeenCalledWith('node', {
        cwd: '/checkout',
      })
    })

    it('rejects when spawned child process is missing the IPC send method', async () => {
      // Simulate a process without a send fn so assertHasSend throws.
      mockSpawn.mockReturnValue({ process: {} })

      await expect(spawnNode(['script.js'])).rejects.toThrow(
        /expected IPC channel on child process/,
      )
    })
  })
})
