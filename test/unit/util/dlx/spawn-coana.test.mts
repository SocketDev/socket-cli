/**
 * Unit tests for util/dlx/spawn-coana.
 *
 * Related Files: - src/util/dlx/spawn-coana.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnCoana } from '../../../../src/util/dlx/spawn-coana.mts'

const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpawnDlx = vi.hoisted(() => vi.fn())

const mockResolveCoana = vi.hoisted(() => vi.fn())
const mockDetectExecutableType = vi.hoisted(() => vi.fn())

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
}))

vi.mock(import('../../../../src/util/dlx/resolve-binary.mts'), () => ({
  resolveCoana: mockResolveCoana,
}))

vi.mock(
  import('../../../../src/command/ci/fetch-default-org-slug.mts'),
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

vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
  getDefaultProxyUrl: mockGetDefaultProxyUrl,
}))

describe('spawnCoana', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCliVersion.mockReturnValue('1.2.3')
    mockGetDefaultApiToken.mockReturnValue(undefined)
    mockGetDefaultProxyUrl.mockReturnValue(undefined)
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: false, message: 'no org' })
  })

  it('runs a local coana binary when resolution is local + binary', async () => {
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: Buffer.from('hello') })

    const result = await spawnCoana(['scan'], { orgSlug: 'my-org' }, undefined)

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

    await spawnCoana([], undefined, undefined)

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      ['/local/coana.js'],
      expect.any(Object),
    )
  })

  it('mixes in SOCKET_CLI_API_TOKEN when getDefaultApiToken returns a value', async () => {
    mockGetDefaultApiToken.mockReturnValue('tok-xyz')
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: undefined })

    await spawnCoana([], { orgSlug: 'org' }, undefined)

    const call = mockSpawn.mock.calls[0]
    expect(call[2].env.SOCKET_CLI_API_TOKEN).toBe('tok-xyz')
    expect(call[2].env.SOCKET_ORG_SLUG).toBe('org')
  })

  it('uses default org slug when none passed and getDefaultOrgSlug succeeds', async () => {
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'auto-org' })
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: undefined })

    await spawnCoana([], undefined, undefined)

    const call = mockSpawn.mock.calls[0]
    expect(call[2].env.SOCKET_ORG_SLUG).toBe('auto-org')
  })

  it('mixes in SOCKET_CLI_API_PROXY when getDefaultProxyUrl returns a value', async () => {
    mockGetDefaultProxyUrl.mockReturnValue('http://proxy:8080')
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: undefined })

    await spawnCoana([], { orgSlug: 'org' }, undefined)

    const call = mockSpawn.mock.calls[0]
    expect(call[2].env.SOCKET_CLI_API_PROXY).toBe('http://proxy:8080')
  })

  it('honors a custom stdio passed via spawnExtra', async () => {
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    mockSpawn.mockResolvedValue({ stdout: undefined })

    await spawnCoana([], { orgSlug: 'org' }, { stdio: 'pipe' })

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

    const result = await spawnCoana([], { orgSlug: 'org' }, undefined)

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

    await spawnCoana([], { orgSlug: 'org', coanaVersion: '2.0.0' }, undefined)

    expect(mockSpawnDlx).toHaveBeenCalledWith(
      expect.objectContaining({ version: '2.0.0' }),
      expect.any(Array),
      expect.any(Object),
      undefined,
    )
  })

  it('forwards SOCKET_CALLER_USER_AGENT so coana can chain our UA', async () => {
    mockResolveCoana.mockReturnValue({
      type: 'dlx',
      details: { name: '@coana-tech/cli', version: '1.0.0' },
    })
    mockSpawnDlx.mockResolvedValue({
      spawnPromise: Promise.resolve({ stdout: undefined }),
    })

    await spawnCoana([], { orgSlug: 'org' }, undefined)

    const env = mockSpawnDlx.mock.calls[0]![2].env
    expect(env['SOCKET_CALLER_USER_AGENT']).toMatch(
      /^\S+\/\S+ node\/\S+ \S+\/\S+$/,
    )
  })

  it('lets a caller-supplied SOCKET_CALLER_USER_AGENT win', async () => {
    mockResolveCoana.mockReturnValue({
      type: 'dlx',
      details: { name: '@coana-tech/cli', version: '1.0.0' },
    })
    mockSpawnDlx.mockResolvedValue({
      spawnPromise: Promise.resolve({ stdout: undefined }),
    })

    await spawnCoana(
      [],
      { orgSlug: 'org', env: { SOCKET_CALLER_USER_AGENT: 'caller/1.0' } },
      undefined,
    )

    const env = mockSpawnDlx.mock.calls[0]![2].env
    expect(env['SOCKET_CALLER_USER_AGENT']).toBe('caller/1.0')
  })

  it('strips npm_package_* from the dlx child env', async () => {
    vi.stubEnv('npm_package_dependencies_lodash', '^4.0.0')
    vi.stubEnv('npm_config_registry', 'https://registry.example/')
    mockResolveCoana.mockReturnValue({
      type: 'dlx',
      details: { name: '@coana-tech/cli', version: '1.0.0' },
    })
    mockSpawnDlx.mockResolvedValue({
      spawnPromise: Promise.resolve({ stdout: undefined }),
    })

    await spawnCoana([], { orgSlug: 'org' }, undefined)

    const env = mockSpawnDlx.mock.calls[0]![2].env
    expect(env).not.toHaveProperty('npm_package_dependencies_lodash')
    // npm_config_* carries registry/proxy/cache and must survive.
    expect(env['npm_config_registry']).toBe('https://registry.example/')
    vi.unstubAllEnvs()
  })

  it('throws when resolveCoana returns an unexpected type', async () => {
    mockResolveCoana.mockReturnValue({
      type: 'github-release',
      details: {} as never,
    })

    const result = await spawnCoana([], { orgSlug: 'org' }, undefined)

    expect(result.ok).toBe(false)
  })

  it('returns ok:false with error message when spawn rejects', async () => {
    mockResolveCoana.mockReturnValue({ type: 'local', path: '/local/coana' })
    mockDetectExecutableType.mockReturnValue({ type: 'binary' })
    const err = Object.assign(new Error('spawn failed'), {
      stderr: 'stderr text',
    })
    mockSpawn.mockRejectedValue(err)

    const result = await spawnCoana([], { orgSlug: 'org' }, undefined)

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

    const result = await spawnCoana([], { orgSlug: 'org' }, undefined)

    expect(result.ok).toBe(false)
    expect((result as { message?: string | undefined }).message).toBe(
      'error-cause-msg',
    )
  })
})
