/**
 * Unit tests for npx shadow binary wrapper.
 *
 * Tests the npx-specific shadow binary that wraps the base shadow implementation
 * for executing packages without installation.
 *
 * Test Coverage:
 * - shadowNpmBase called with NPX binary constant
 * - Custom options passed to shadowNpmBase (cwd, env, ipc)
 * - Extra parameters forwarding (timeout, etc.)
 * - Default process.argv usage when no args provided
 * - Empty args array handling
 * - Readonly args array handling
 * - Package execution with arguments (jest --coverage --watch)
 * - Scoped packages (@angular/cli)
 * - Package with version specification (@latest, @version)
 * - Spawn result structure preservation
 * - Error handling from shadowNpmBase
 *
 * Testing Approach:
 * - Mock shadowNpmBase module
 * - Validate arguments passed to base implementation
 * - Test with various npx command patterns (create-react-app, cowsay, jest, etc.)
 * - Verify return value structure
 *
 * Related Files:
 * - src/shadow/npx/bin.mts - npx shadow binary wrapper
 * - src/shadow/npm-base.mts - Base shadow binary implementation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NPX } from '@socketsecurity/lib/constants/agents'

import shadowNpxBin from '../../../../src/shadow/npx/bin.mts'

import type { ShadowBinOptions } from '../../../../src/shadow/npm-base.mts'

// Mock shadowNpmBase.
const mockShadowNpmBase = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/shadow/npm-base.mts', () => ({
  default: mockShadowNpmBase,
}))

describe('shadowNpxBin', () => {
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

  it('should call shadowNpmBase with NPX binary', async () => {
    const args = ['create-react-app', 'my-app']
    const result = await shadowNpxBin(args)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(
      NPX,
      args,
      undefined,
      undefined,
    )
    expect(result).toBe(mockSpawnResult)
  })

  it('should pass custom options to shadowNpmBase', async () => {
    const args = ['cowsay', 'hello']
    const options: ShadowBinOptions = {
      cwd: '/custom/path',
      env: { CUSTOM_ENV: 'test' },
      ipc: { test: 'data' },
    }
    const extra = { timeout: 5000 }

    const result = await shadowNpxBin(args, options, extra)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(NPX, args, options, extra)
    expect(result).toBe(mockSpawnResult)
  })

  it('should use default process.argv when no args provided', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'script.js', 'create-vue', 'my-vue-app']

    try {
      await shadowNpxBin()

      expect(mockShadowNpmBase).toHaveBeenCalledWith(
        NPX,
        ['create-vue', 'my-vue-app'],
        undefined,
        undefined,
      )
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty args array', async () => {
    const args: string[] = []
    await shadowNpxBin(args)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(
      NPX,
      args,
      undefined,
      undefined,
    )
  })

  it('should pass readonly args array correctly', async () => {
    const args: readonly string[] = ['typescript', '--version'] as const
    await shadowNpxBin(args)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(
      NPX,
      args,
      undefined,
      undefined,
    )
  })

  it('should handle package execution with arguments', async () => {
    const args = ['jest', '--coverage', '--watch']
    await shadowNpxBin(args)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(
      NPX,
      args,
      undefined,
      undefined,
    )
  })

  it('should handle scoped packages', async () => {
    const args = ['@angular/cli', 'new', 'my-app']
    await shadowNpxBin(args)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(
      NPX,
      args,
      undefined,
      undefined,
    )
  })

  it('should preserve spawn result structure', async () => {
    const result = await shadowNpxBin(['create-react-app'])

    expect(result).toHaveProperty('spawnPromise')
    expect(result.spawnPromise).toHaveProperty('process')
    expect(result.spawnPromise).toHaveProperty('then')
  })

  it('should handle shadow npm base errors', async () => {
    const error = new Error('Shadow npm base failed')
    mockShadowNpmBase.mockRejectedValue(error)

    await expect(shadowNpxBin(['create-react-app'])).rejects.toThrow(
      'Shadow npm base failed',
    )
  })

  it('should handle package with version specification', async () => {
    const args = ['create-react-app@latest', 'my-app']
    await shadowNpxBin(args)

    expect(mockShadowNpmBase).toHaveBeenCalledWith(
      NPX,
      args,
      undefined,
      undefined,
    )
  })
})
