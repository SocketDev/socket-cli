import { beforeEach, describe, expect, it, vi } from 'vitest'

import shadowNpmBin from './bin.mts'

// Mock all dependencies with vi.hoisted for better type safety.
const mockInstallNpmLinks = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())
const mockFindUp = vi.hoisted(() => vi.fn())

vi.mock('../../utils/shadow/links.mts', () => ({
  installNpmLinks: mockInstallNpmLinks,
}))

vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('../../utils/fs/find-up.mts', () => ({
  findUp: mockFindUp,
}))

vi.mock('../../constants.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    default: {
      ...actual?.default,
      EXEC_PATH: '/usr/bin/node',
      NPM_CACHE_PATH: '/home/.npm',
      NPM_GLOBAL_PREFIX: '/usr/local',
      NODE_DEBUG_FLAGS: [],
      NODE_HARDEN_FLAGS: [],
      NODE_MEMORY_FLAGS: [],
      NODE_NO_WARNINGS_FLAGS: [],
      SHADOW_BIN_PATH: '/mock/shadow-bin',
      SHADOW_NPM_INJECT_PATH: '/mock/inject.js',
      SUPPORTS_NODE_PERMISSION_FLAG: false,
      processEnv: {},
    },
  }
})

describe('shadowNpmBin', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations.
    mockInstallNpmLinks.mockResolvedValue('/usr/bin/npm')
    mockFindUp.mockResolvedValue(null)
    mockSpawn.mockReturnValue({
      process: {
        on: vi.fn(),
        send: vi.fn(),
      },
      then: vi.fn().mockImplementation(cb =>
        cb({
          code: 0,
          stderr: '',
          stdout: '',
          success: true,
        }),
      ),
    })
  })

  it('should accept args as an array and handle findLast correctly', async () => {
    const args = ['install', '--no-progress', '--loglevel=error']
    const result = await shadowNpmBin(args)

    expect(result).toHaveProperty('spawnPromise')
    expect(mockSpawn).toHaveBeenCalled()

    // Verify spawn was called with correct arguments.
    const spawnArgs = mockSpawn.mock.calls[0]
    expect(spawnArgs).toBeDefined()
  })

  it('should handle array with terminator correctly', async () => {
    const args = ['install', '--', 'extra', 'args']
    const result = await shadowNpmBin(args)

    expect(result).toHaveProperty('spawnPromise')
    expect(mockSpawn).toHaveBeenCalled()
  })

  it('should handle empty args array', async () => {
    const args: string[] = []
    const result = await shadowNpmBin(args)

    expect(result).toHaveProperty('spawnPromise')
    expect(mockSpawn).toHaveBeenCalled()
  })

  it('should handle readonly array correctly', async () => {
    const args: readonly string[] = ['install', 'lodash'] as const
    const result = await shadowNpmBin(args)

    expect(result).toHaveProperty('spawnPromise')
    expect(mockSpawn).toHaveBeenCalled()
  })

  it('should not throw "findLast is not a function" error', async () => {
    // This test specifically validates the fix for issue #911.
    // The bug was caused by passing a string instead of an array,
    // which made rawBinArgs.findLast() fail because strings don't
    // have the findLast method.
    const args = ['install', '--progress']

    await expect(shadowNpmBin(args)).resolves.toHaveProperty('spawnPromise')
  })

  it('should correctly identify progress flags using findLast', async () => {
    // Test that findLast correctly finds the last progress flag.
    const args = ['install', '--progress', '--no-progress']
    await shadowNpmBin(args)

    // Verify spawn was called - the actual flag processing happens inside.
    expect(mockSpawn).toHaveBeenCalled()
    const spawnArgs = mockSpawn.mock.calls[0][1] as string[]

    // Should include --no-progress in the final args since it was last.
    expect(spawnArgs).toContain('--no-progress')
  })
})
