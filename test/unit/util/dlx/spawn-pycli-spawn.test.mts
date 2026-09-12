/**
 * Unit tests for util/dlx/spawn-pycli.
 *
 * Related Files:
 *
 * - Src/util/dlx/spawn-pycli.mts
 * - Spawn-pycli.test.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import { spawnSocketPyCli } from '../../../../src/util/dlx/spawn-pycli.mts'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpawnNode = vi.hoisted(() => vi.fn())
const mockDownloadBinary = vi.hoisted(() => vi.fn())
const mockGetDlxCachePath = vi.hoisted(() => vi.fn(() => '/tmp/dlx'))
const mockExistsSync = vi.hoisted(() => vi.fn(() => false))
const mockFsCopyFile = vi.hoisted(() => vi.fn(async () => {}))
const mockResolvePyCli = vi.hoisted(() => vi.fn())

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

describe('spawnSocketPyCli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSocketCliPythonPath = undefined

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

  it('returns ok:false when spawn throws', async () => {
    mockResolvePyCli.mockReturnValue({ type: 'local', path: '/local/py' })
    mockSpawnNode.mockRejectedValue(new Error('boom'))
    const result = await spawnSocketPyCli([])
    expect(result.ok).toBe(false)
  })
})
