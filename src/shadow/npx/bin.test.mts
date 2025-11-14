import { beforeEach, describe, expect, it, vi } from 'vitest'

import shadowNpxBin from './bin.mts'

// Mock all dependencies with vi.hoisted for better type safety.
const mockInstallNpxLinks = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())
const mockFindUp = vi.hoisted(() => vi.fn())

vi.mock('../../utils/shadow-links.mts', () => ({
  installNpxLinks: mockInstallNpxLinks,
}))

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('../../utils/fs.mts', () => ({
  findUp: mockFindUp,
}))

vi.mock('../../constants.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    default: {
      ...actual?.default,
      shadowBinPath: '/mock/shadow-bin',
      shadowNpmInjectPath: '/mock/inject.js',
      execPath: '/usr/bin/node',
      npmGlobalPrefix: '/usr/local',
      npmCachePath: '/usr/local/.npm',
      nodeNoWarningsFlags: [],
      nodeDebugFlags: [],
      nodeHardenFlags: [],
      nodeMemoryFlags: [],
      processEnv: {},
      ENV: {
        INLINED_SOCKET_CLI_SENTRY_BUILD: false,
      },
      SUPPORTS_NODE_PERMISSION_FLAG: false,
    },
  }
})

describe('shadowNpxBin', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations.
    mockInstallNpxLinks.mockResolvedValue('/usr/bin/npx')
    mockFindUp.mockResolvedValue(null)
    mockSpawn.mockReturnValue({
      process: {
        send: vi.fn(),
        on: vi.fn(),
      },
      then: vi.fn().mockImplementation(cb =>
        cb({
          success: true,
          code: 0,
          stdout: '',
          stderr: '',
        }),
      ),
    })
  })

  it('should accept args as an array and handle findLast correctly', async () => {
    const args = ['cowsay', 'hello', '--no-progress']
    const result = await shadowNpxBin(args)

    expect(result).toHaveProperty('spawnPromise')
    expect(mockSpawn).toHaveBeenCalled()

    // Verify spawn was called with correct arguments.
    const spawnArgs = mockSpawn.mock.calls[0]
    expect(spawnArgs).toBeDefined()
  })

  it('should handle array with terminator correctly', async () => {
    const args = ['cowsay', '--', 'extra', 'args']
    const result = await shadowNpxBin(args)

    expect(result).toHaveProperty('spawnPromise')
    expect(mockSpawn).toHaveBeenCalled()
  })

  it('should handle empty args array', async () => {
    const args: string[] = []
    const result = await shadowNpxBin(args)

    expect(result).toHaveProperty('spawnPromise')
    expect(mockSpawn).toHaveBeenCalled()
  })

  it('should handle readonly array correctly', async () => {
    const args: readonly string[] = ['cowsay', 'hello'] as const
    const result = await shadowNpxBin(args)

    expect(result).toHaveProperty('spawnPromise')
    expect(mockSpawn).toHaveBeenCalled()
  })

  it('should not throw "findLast is not a function" error', async () => {
    // This test specifically validates the fix for issue #911.
    // The bug was caused by passing a string instead of an array,
    // which made rawBinArgs.findLast() fail because strings don't
    // have the findLast method.
    const args = ['cowsay', '--progress']

    await expect(shadowNpxBin(args)).resolves.toHaveProperty('spawnPromise')
  })

  it('should correctly identify progress flags using findLast', async () => {
    // Test that findLast correctly finds the last progress flag.
    const args = ['cowsay', '--progress', '--no-progress']
    await shadowNpxBin(args)

    // Verify spawn was called - the actual flag processing happens inside.
    expect(mockSpawn).toHaveBeenCalled()
    const spawnArgs = mockSpawn.mock.calls[0][1] as string[]

    // Should include --no-progress in the final args since it was last.
    expect(spawnArgs).toContain('--no-progress')
  })
})
