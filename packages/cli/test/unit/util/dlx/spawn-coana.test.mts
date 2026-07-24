/**
 * Unit tests for util/dlx/spawn-coana.
 *
 * Covers spawnCoana, spawnCoanaDlx, and spawnCoanaVfs paths.
 *
 * Related Files: - src/util/dlx/spawn-coana.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpawnDlx = vi.hoisted(() => vi.fn())
const mockSpawnToolVfs = vi.hoisted(() => vi.fn())
const mockResolveCoana = vi.hoisted(() => vi.fn())
const mockDetectExecutableType = vi.hoisted(() => vi.fn())
const mockAreExternalToolsAvailable = vi.hoisted(() => vi.fn(() => false))
const mockIsSeaBinary = vi.hoisted(() => vi.fn(() => false))
const mockGetCliVersion = vi.hoisted(() => vi.fn(() => '1.2.3'))
const mockGetDefaultApiToken = vi.hoisted(() => vi.fn(() => undefined))
const mockGetDefaultProxyUrl = vi.hoisted(() => vi.fn(() => undefined))
const mockGetDefaultOrgSlug = vi.hoisted(() =>
  vi.fn(async () => ({ ok: false, message: 'no org' })),
)
const mockGetErrorCause = vi.hoisted(() => vi.fn((e: unknown) => String(e)))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('@socketsecurity/lib-stable/dlx/detect'), () => ({
  detectExecutableType: mockDetectExecutableType,
}))

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  spawnDlx: mockSpawnDlx,
  spawnToolVfs: mockSpawnToolVfs,
}))

vi.mock(import('../../../../src/util/dlx/resolve-binary.mts'), () => ({
  resolveCoana: mockResolveCoana,
}))

vi.mock(import('../../../../src/util/dlx/vfs-extract.mts'), () => ({
  areExternalToolsAvailable: mockAreExternalToolsAvailable,
}))

vi.mock(
  import('../../../../src/commands/ci/fetch-default-org-slug.mts'),
  () => ({
    getDefaultOrgSlug: mockGetDefaultOrgSlug,
  }),
)

vi.mock(import('../../../../src/env/cli-version.mts'), () => ({
  getCliVersion: mockGetCliVersion,
}))

vi.mock(import('../../../../src/util/error/errors.mts'), () => ({
  getErrorCause: mockGetErrorCause,
}))

vi.mock(import('../../../../src/util/sea/detect.mts'), () => ({
  isSeaBinary: mockIsSeaBinary,
}))

vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
  getDefaultProxyUrl: mockGetDefaultProxyUrl,
}))

import {
  spawnCoana,
  spawnCoanaDlx,
  spawnCoanaVfs,
} from '../../../../src/util/dlx/spawn-coana.mts'

describe('spawnCoanaDlx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCliVersion.mockReturnValue('1.2.3')
    mockGetDefaultApiToken.mockReturnValue(undefined)
    mockGetDefaultProxyUrl.mockReturnValue(undefined)
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: false, message: 'no org' })
    mockIsSeaBinary.mockReturnValue(false)
    mockAreExternalToolsAvailable.mockReturnValue(false)
  })

  it('runs a local coana binary when resolution is local + binary', async () => {
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('hello') })

    const result = await spawnCoanaDlx(['scan'], 'my-org', undefined, undefined)

    expect(mockSpawn).toHaveBeenCalledWith(
      '/local/coana',
      ['scan'],
      expect.objectContaining({ stdio: 'inherit' }),
    )
    expect(result).toEqual({ ok: true, data: 'hello' })
  })

  it('runs the local coana.js via node when not a binary', async () => {
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana.js' })
    mockDetectExecutableType.mockReturnValue({ type: 'script' })
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('') })

    await spawnCoanaDlx([], undefined, undefined, undefined)

    expect(mockSpawn).toHaveBeenCalledWith(
      'node',
      ['/local/coana.js'],
      expect.any(Object),
    )
  })

  it('mixes in SOCKET_CLI_API_TOKEN when getDefaultApiToken returns a value', async () => {
    mockGetDefaultApiToken.mockReturnValue('tok-xyz')
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: undefined })

    await spawnCoanaDlx([], 'org', undefined, undefined)

    const call = mockSpawn.mock.calls[0]
    expect(call[2].env.SOCKET_CLI_API_TOKEN).toBe('tok-xyz')
    expect(call[2].env.SOCKET_ORG_SLUG).toBe('org')
  })

  it('uses default org slug when none passed and getDefaultOrgSlug succeeds', async () => {
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'auto-org' })
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: undefined })

    await spawnCoanaDlx([], undefined, undefined, undefined)

    const call = mockSpawn.mock.calls[0]
    expect(call[2].env.SOCKET_ORG_SLUG).toBe('auto-org')
  })

  it('mixes in SOCKET_CLI_API_PROXY when getDefaultProxyUrl returns a value', async () => {
    mockGetDefaultProxyUrl.mockReturnValue('http://proxy:8080')
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: undefined })

    await spawnCoanaDlx([], 'org', undefined, undefined)

    const call = mockSpawn.mock.calls[0]
    expect(call[2].env.SOCKET_CLI_API_PROXY).toBe('http://proxy:8080')
  })

  it('honors a custom stdio passed via spawnExtra', async () => {
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: undefined })

    await spawnCoanaDlx([], 'org', undefined, { stdio: 'pipe' })

    expect(mockSpawn).toHaveBeenCalledWith(
      '/local/coana',
      [],
      expect.objectContaining({ stdio: 'pipe' }),
    )
  })

  it('falls back to spawnDlx when resolution.type is "dlx"', async () => {
    mockResolveCoana.mockReturnValue({
      type: 'dlx',
      details: { name: '@coana-tech/cli', version: '1.0.0' },
    })
    mockSpawnDlx.mockResolvedValue({
      spawnPromise: Promise.resolve({ stdout: Buffer.from('dlx-out') }),
    })

    const result = await spawnCoanaDlx([], 'org', undefined, undefined)

    expect(mockSpawnDlx).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, data: 'dlx-out' })
  })

  it('uses coanaVersion override when provided', async () => {
    mockResolveCoana.mockReturnValue({
      type: 'dlx',
      details: { name: '@coana-tech/cli', version: '1.0.0' },
    })
    mockSpawnDlx.mockResolvedValue({
      spawnPromise: Promise.resolve({ stdout: undefined }),
    })

    await spawnCoanaDlx([], 'org', { coanaVersion: '2.0.0' }, undefined)

    expect(mockSpawnDlx).toHaveBeenCalledWith(
      expect.objectContaining({ version: '2.0.0' }),
      expect.any(Array),
      expect.any(Object),
      undefined,
    )
  })

  it('throws when resolveCoana returns an unexpected type', async () => {
    mockResolveCoana.mockReturnValue({
      type: 'github-release',
      details: {} as never,
    })

    const result = await spawnCoanaDlx([], 'org', undefined, undefined)

    expect(result.ok).toBe(false)
  })

  it('returns ok:false with error message when spawn rejects', async () => {
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    const err = Object.assign(new Error('spawn failed'), {
      stderr: 'stderr text',
    })
    mockSpawn.mockRejectedValue(err)

    const result = await spawnCoanaDlx([], 'org', undefined, undefined)

    expect(result.ok).toBe(false)
    expect((result as { message?: string | undefined }).message).toBe(
      'stderr text',
    )
  })

  it('uses getErrorCause when no stderr present on rejection', async () => {
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockRejectedValue(new Error('boom'))
    mockGetErrorCause.mockReturnValue('error-cause-msg')

    const result = await spawnCoanaDlx([], 'org', undefined, undefined)

    expect(result.ok).toBe(false)
    expect((result as { message?: string | undefined }).message).toBe(
      'error-cause-msg',
    )
  })
})

describe('spawnCoanaVfs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCliVersion.mockReturnValue('1.2.3')
    mockGetDefaultApiToken.mockReturnValue(undefined)
    mockGetDefaultProxyUrl.mockReturnValue(undefined)
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: false, message: 'no org' })
  })

  it('spawns coana through spawnToolVfs and returns stdout', async () => {
    mockSpawnToolVfs.mockResolvedValue({
      spawnPromise: Promise.resolve({ stdout: Buffer.from('vfs-out') }),
    })

    const result = await spawnCoanaVfs(['args'], undefined, undefined)

    expect(mockSpawnToolVfs).toHaveBeenCalledWith(
      'coana',
      ['args'],
      expect.any(Object),
      undefined,
    )
    expect(result).toEqual({ ok: true, data: 'vfs-out' })
  })

  it('returns empty string when stdout missing', async () => {
    mockSpawnToolVfs.mockResolvedValue({
      spawnPromise: Promise.resolve({ stdout: undefined }),
    })

    const result = await spawnCoanaVfs([], undefined, undefined)
    expect(result).toEqual({ ok: true, data: '' })
  })

  it('mixes API token / org slug / proxy into spawn env', async () => {
    mockGetDefaultApiToken.mockReturnValue('tok')
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'org-1' })
    mockGetDefaultProxyUrl.mockReturnValue('http://proxy')
    mockSpawnToolVfs.mockResolvedValue({
      spawnPromise: Promise.resolve({ stdout: undefined }),
    })

    await spawnCoanaVfs([], undefined, undefined)

    const opts = mockSpawnToolVfs.mock.calls[0][2]
    expect(opts.env.SOCKET_CLI_API_TOKEN).toBe('tok')
    expect(opts.env.SOCKET_ORG_SLUG).toBe('org-1')
    expect(opts.env.SOCKET_CLI_API_PROXY).toBe('http://proxy')
    expect(opts.env.SOCKET_CLI_VERSION).toBe('1.2.3')
  })

  it('returns ok:false with stderr when spawnToolVfs throws with stderr', async () => {
    const err = Object.assign(new Error('vfs boom'), { stderr: 'stderr-vfs' })
    mockSpawnToolVfs.mockRejectedValue(err)

    const result = await spawnCoanaVfs([], undefined, undefined)
    expect(result.ok).toBe(false)
    expect((result as { message?: string | undefined }).message).toBe(
      'stderr-vfs',
    )
  })

  it('returns ok:false with cause when spawnToolVfs throws without stderr', async () => {
    mockSpawnToolVfs.mockRejectedValue(new Error('plain'))
    mockGetErrorCause.mockReturnValue('plain-cause')

    const result = await spawnCoanaVfs([], undefined, undefined)
    expect(result.ok).toBe(false)
    expect((result as { message?: string | undefined }).message).toBe(
      'plain-cause',
    )
  })
})

describe('spawnCoana (auto-dispatch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCliVersion.mockReturnValue('1.2.3')
    mockGetDefaultApiToken.mockReturnValue(undefined)
    mockGetDefaultProxyUrl.mockReturnValue(undefined)
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: false, message: 'no org' })
  })

  it('routes to spawnCoanaVfs when SEA + external tools available', async () => {
    mockIsSeaBinary.mockReturnValue(true)
    mockAreExternalToolsAvailable.mockReturnValue(true)
    mockSpawnToolVfs.mockResolvedValue({
      spawnPromise: Promise.resolve({ stdout: Buffer.from('via-vfs') }),
    })

    const result = await spawnCoana(['x'], 'org', undefined, undefined)

    expect(mockSpawnToolVfs).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, data: 'via-vfs' })
  })

  it('routes to spawnCoanaDlx when not in SEA mode', async () => {
    mockIsSeaBinary.mockReturnValue(false)
    mockAreExternalToolsAvailable.mockReturnValue(false)
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('via-dlx') })

    const result = await spawnCoana(['x'], 'org', undefined, undefined)

    expect(mockSpawn).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, data: 'via-dlx' })
  })

  it('routes to spawnCoanaDlx when SEA but external tools missing', async () => {
    mockIsSeaBinary.mockReturnValue(true)
    mockAreExternalToolsAvailable.mockReturnValue(false)
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('') })

    await spawnCoana(['x'], 'org', undefined, undefined)
    expect(mockSpawn).toHaveBeenCalled()
  })
})
