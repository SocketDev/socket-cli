import { describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn(async () => ({ stdout: '11.6.0' }))
const resolveBinPathSyncMock = vi.fn(() => '/fake/npm-cli.js')
const whichBinMock = vi.fn(async () => 'npm')

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: spawnMock,
}))

vi.mock('@socketsecurity/registry/lib/bin', () => ({
  resolveBinPathSync: resolveBinPathSyncMock,
  whichBin: whichBinMock,
}))

vi.mock('../src/utils/fs.mts', () => ({
  findUp: vi.fn(async () => undefined),
}))

// Mock constants to simulate Windows platform for these tests.
// These tests specifically verify Windows-specific npm version detection behavior.
vi.mock('../src/constants.mts', async importOriginal => {
  const actual = (await importOriginal()) as unknown
  return {
    ...actual,
    default: {
      ...actual.default,
      WIN32: true,
    },
  }
})

describe('detectPackageEnvironment - Windows npm version detection', () => {
  it('detects npm version when resolved to JS entrypoint', async () => {
    spawnMock.mockClear()
    resolveBinPathSyncMock.mockClear()
    whichBinMock.mockClear()
    resolveBinPathSyncMock.mockReturnValue('/fake/npm-cli.js')
    spawnMock.mockResolvedValue({ stdout: '11.6.0' })

    const { detectPackageEnvironment } = await import(
      '../src/utils/package-environment.mts'
    )
    const details = await detectPackageEnvironment({ cwd: process.cwd() })

    expect(details.agent).toBe('npm')
    expect(details.agentVersion?.major).toBe(11)

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['/fake/npm-cli.js', '--version']),
      expect.objectContaining({ cwd: process.cwd() }),
    )
  })

  it('falls back to direct spawn when resolveBinPathSync fails', async () => {
    spawnMock.mockClear()
    resolveBinPathSyncMock.mockClear()
    whichBinMock.mockClear()
    resolveBinPathSyncMock.mockImplementation(() => {
      throw new Error('Resolution failed')
    })
    spawnMock.mockResolvedValue({ stdout: '10.5.0' })

    const { detectPackageEnvironment } = await import(
      '../src/utils/package-environment.mts'
    )
    const details = await detectPackageEnvironment({ cwd: process.cwd() })

    expect(details.agent).toBe('npm')
    expect(details.agentVersion?.major).toBe(10)

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['--version'],
      expect.objectContaining({
        cwd: process.cwd(),
        shell: true,
      }),
    )
  })

  it('uses direct spawn when resolved to non-JS executable', async () => {
    spawnMock.mockClear()
    resolveBinPathSyncMock.mockClear()
    whichBinMock.mockClear()
    resolveBinPathSyncMock.mockReturnValue('/fake/npm.cmd')
    spawnMock.mockResolvedValue({ stdout: '9.8.1' })

    const { detectPackageEnvironment } = await import(
      '../src/utils/package-environment.mts'
    )
    const details = await detectPackageEnvironment({ cwd: process.cwd() })

    expect(details.agent).toBe('npm')
    expect(details.agentVersion?.major).toBe(9)

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['--version'],
      expect.objectContaining({
        cwd: process.cwd(),
        shell: true,
      }),
    )
  })
})
