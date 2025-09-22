import { beforeEach, describe, expect, it, vi } from 'vitest'

import shadowNpmBin from './bin.mts'
import { NPM } from '../../constants.mts'

import type { ShadowBinOptions } from '../npm-base.mts'

// Mock shadowNpmBase.
const mockShadowNpmBase = vi.hoisted(() => vi.fn())

vi.mock('../npm-base.mts', () => ({
  default: mockShadowNpmBase,
}))

describe('shadowNpmBin', () => {
  const mockSpawnResult = {
    spawnPromise: {
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
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations.
    mockShadowNpmBase.mockResolvedValue(mockSpawnResult)
  })

  it('should call shadowNpmBase with NPM binary', async () => {
    const args = ['install', 'lodash']
    const result = await shadowNpmBin(args)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(NPM, args, undefined, undefined)
    expect(result).toBe(mockSpawnResult)
  })

  it('should pass custom options to shadowNpmBase', async () => {
    const args = ['install', 'lodash']
    const options: ShadowBinOptions = {
      cwd: '/custom/path',
      env: { CUSTOM_ENV: 'test' },
      ipc: { test: 'data' },
    }
    const extra = { timeout: 5000 }

    const result = await shadowNpmBin(args, options, extra)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(NPM, args, options, extra)
    expect(result).toBe(mockSpawnResult)
  })

  it('should use default process.argv when no args provided', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'script.js', 'install', 'react']

    try {
      await shadowNpmBin()

      expect(mockShadowNpmBase).toHaveBeenCalledWith(NPM, ['install', 'react'], undefined, undefined)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty args array', async () => {
    const args: string[] = []
    await shadowNpmBin(args)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(NPM, args, undefined, undefined)
  })

  it('should pass readonly args array correctly', async () => {
    const args: readonly string[] = ['install', 'typescript'] as const
    await shadowNpmBin(args)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(NPM, args, undefined, undefined)
  })

  it('should handle complex npm commands', async () => {
    const args = ['install', 'lodash@4.17.21', '--save-dev', '--no-audit']
    await shadowNpmBin(args)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(NPM, args, undefined, undefined)
  })

  it('should preserve spawn result structure', async () => {
    const result = await shadowNpmBin(['install'])

    expect(result).toHaveProperty('spawnPromise')
    expect(result.spawnPromise).toHaveProperty('process')
    expect(result.spawnPromise).toHaveProperty('then')
  })

  it('should handle shadow npm base errors', async () => {
    const error = new Error('Shadow npm base failed')
    mockShadowNpmBase.mockRejectedValue(error)

    await expect(shadowNpmBin(['install'])).rejects.toThrow('Shadow npm base failed')
  })
})