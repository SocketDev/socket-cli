/**
 * Unit tests for util/dlx/spawn-pycli.
 *
 * Covers spawnSocketPyCli, spawnSocketPyCliDlx, and spawnSocketPyCliVfs.
 *
 * Related Files:
 *
 * - Src/util/dlx/spawn-pycli.mts
 * - Spawn-pycli.test.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as NodeFs from 'node:fs'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpawnNode = vi.hoisted(() => vi.fn())
const mockDownloadBinary = vi.hoisted(() => vi.fn())
const mockGetDlxCachePath = vi.hoisted(() => vi.fn(() => '/tmp/dlx'))
const mockExistsSync = vi.hoisted(() => vi.fn(() => false))
const mockFsCopyFile = vi.hoisted(() => vi.fn(async () => {}))
const mockResolvePyCli = vi.hoisted(() => vi.fn())
const mockAreBasicsToolsAvailable = vi.hoisted(() => vi.fn(() => false))
const mockExtractBasicsTools = vi.hoisted(() => vi.fn(async () => undefined))
const mockGetBasicsToolPaths = vi.hoisted(() =>
  vi.fn(() => ({ python: '/basics/python' })),
)
const mockIsSeaBinary = vi.hoisted(() => vi.fn(() => false))
const mockSocketHttpRequest = vi.hoisted(() => vi.fn())
const mockGetPyCliVersion = vi.hoisted(() => vi.fn(() => '2.3.4'))
const mockGetPyCliChecksums = vi.hoisted(() => vi.fn(() => ({})))

let mockSocketCliPythonPath: string | undefined = undefined
vi.mock(import('../../../../src/env/socket-cli-python-path.mts'), () => ({
  get SOCKET_CLI_PYTHON_PATH() {
    return mockSocketCliPythonPath
  },
}))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('@socketsecurity/lib-stable/dlx/binary'), () => ({
  downloadBinary: mockDownloadBinary,
  getDlxCachePath: mockGetDlxCachePath,
}))

vi.mock(import('node:fs'), async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const promises = {
    copyFile: mockFsCopyFile,
  }
  return {
    ...actual,
    existsSync: mockExistsSync,
    promises,
    default: { ...actual, existsSync: mockExistsSync, promises },
  }
})

vi.mock(import('../../../../src/util/dlx/resolve-binary.mts'), () => ({
  resolvePyCli: mockResolvePyCli,
}))

vi.mock(import('../../../../src/util/basics/vfs-extract.mts'), () => ({
  areBasicsToolsAvailable: mockAreBasicsToolsAvailable,
  extractBasicsTools: mockExtractBasicsTools,
  getBasicsToolPaths: mockGetBasicsToolPaths,
}))

vi.mock(import('../../../../src/util/sea/detect.mts'), () => ({
  isSeaBinary: mockIsSeaBinary,
}))

vi.mock(import('../../../../src/util/socket/api.mts'), () => ({
  socketHttpRequest: mockSocketHttpRequest,
}))

vi.mock(import('../../../../src/util/spawn/spawn-node.mts'), () => ({
  spawnNode: mockSpawnNode,
}))

vi.mock(import('../../../../src/env/pycli-version.mts'), () => ({
  getPyCliVersion: mockGetPyCliVersion,
}))

vi.mock(import('../../../../src/env/pycli-checksums.mts'), () => ({
  getPyCliChecksums: mockGetPyCliChecksums,
}))

import {
  spawnSocketPyCli,
  spawnSocketPyCliDlx,
  spawnSocketPyCliVfs,
} from '../../../../src/util/dlx/spawn-pycli.mts'

describe('spawnSocketPyCli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSocketCliPythonPath = undefined
    mockIsSeaBinary.mockReturnValue(false)
    mockAreBasicsToolsAvailable.mockReturnValue(false)
    mockExistsSync.mockReturnValue(true)
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('out'), code: 0 })
    mockSpawnNode.mockResolvedValue({ stdout: Buffer.from('node-out') })
    mockResolvePyCli.mockReturnValue({ type: 'python' })
  })

  it('runs local resolution path via spawnNode', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    const result = await spawnSocketPyCli(['scan'])
    expect(mockSpawnNode).toHaveBeenCalledWith(
      ['/local/py', 'scan'],
      expect.any(Object),
    )
    expect(result.ok).toBe(true)
  })

  it('runs local resolution with cwd from options', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    await spawnSocketPyCli(['scan'], { cwd: '/wd' })
    expect(mockSpawnNode).toHaveBeenCalledWith(
      ['/local/py', 'scan'],
      expect.objectContaining({ cwd: '/wd' }),
    )
  })

  it('uses ensurePython + ensureSocketPyCli + spawn for non-local resolution', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'python' })
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('ok'), code: 0 })

    const result = await spawnSocketPyCli(['x'])
    expect(result.ok).toBe(true)
  })

  it('builds isolated PATH when SEA + basics tools available', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'python' })
    mockIsSeaBinary.mockReturnValue(true)
    mockAreBasicsToolsAvailable.mockReturnValue(true)
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('ok'), code: 0 })

    await spawnSocketPyCli(['x'])
    // The final spawn call should include a PATH env.
    const lastCall = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1]
    expect(lastCall[2].env.PATH).toBeTruthy()
  })

  it('returns ok:false when spawn throws', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    mockSpawnNode.mockRejectedValue(new Error('boom'))
    const result = await spawnSocketPyCli([])
    expect(result.ok).toBe(false)
  })
})

describe('spawnSocketPyCliDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('ok'), code: 0 })
    mockSpawnNode.mockResolvedValue({ stdout: Buffer.from('node-out') })
  })

  it('runs local resolution via spawnNode', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    const result = await spawnSocketPyCliDlx(['x'])
    expect(mockSpawnNode).toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  it('runs local resolution with cwd', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    await spawnSocketPyCliDlx([], { cwd: '/wd' })
    expect(mockSpawnNode).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ cwd: '/wd' }),
    )
  })

  it('uses ensurePythonDlx for non-local resolution', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'python' })
    const result = await spawnSocketPyCliDlx([])
    expect(result.ok).toBe(true)
  })

  it('returns ok:false on error', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    mockSpawnNode.mockRejectedValue(new Error('boom'))
    const result = await spawnSocketPyCliDlx([])
    expect(result.ok).toBe(false)
  })
})

describe('spawnSocketPyCliVfs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('ok') })
    mockGetPyCliVersion.mockReturnValue('1.2.3')
    mockGetPyCliChecksums.mockReturnValue({})
    mockSocketHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        urls: [{ filename: 'wheel.whl', url: 'http://x' }],
      }),
    })
    mockDownloadBinary.mockResolvedValue({ binaryPath: '/dl' })
    mockFsCopyFile.mockResolvedValue(undefined)
  })

  it('returns ok:false when extractBasicsTools returns null', async () => {
    mockExtractBasicsTools.mockResolvedValue(undefined)
    const result = await spawnSocketPyCliVfs([])
    expect(result.ok).toBe(false)
  })

  it('runs full flow without checksums (dev mode)', async () => {
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)
    const result = await spawnSocketPyCliVfs(['x'])
    expect(result.ok).toBe(true)
  })

  it('runs full flow with checksums (verified wheel)', async () => {
    mockGetPyCliChecksums.mockReturnValue({
      'socketsecurity-1.2.3-py3-none-any.whl': 'sha',
    })
    mockExistsSync.mockReturnValue(true)
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)
    const result = await spawnSocketPyCliVfs(['x'])
    expect(result.ok).toBe(true)
  })

  it('throws when checksum present but wheel download fails', async () => {
    mockGetPyCliChecksums.mockReturnValue({
      'socketsecurity-1.2.3-py3-none-any.whl': 'sha',
    })
    mockSocketHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({ urls: [] }),
    })
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)

    const result = await spawnSocketPyCliVfs(['x'])
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when spawn throws during install', async () => {
    mockExtractBasicsTools.mockResolvedValue('/sea/tools' as never)
    mockGetBasicsToolPaths.mockReturnValue({ python: '/sea/python' } as never)
    mockSpawn.mockRejectedValue(new Error('boom'))
    const result = await spawnSocketPyCliVfs([])
    expect(result.ok).toBe(false)
  })
})
