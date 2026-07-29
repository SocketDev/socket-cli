/**
 * Unit tests for the Java prerequisite probe used by Bazel Maven extraction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  ensureJavaOnPath,
  resetJavaShimCacheForTests,
} from '../../../../../src/commands/manifest/bazel/bazel-java-shim.mts'

type SpawnResolution = Awaited<ReturnType<typeof spawn>>

describe('ensureJavaOnPath', () => {
  const mockedSpawn = vi.mocked(spawn)

  let originalJavaHome: string | undefined
  let originalPath: string | undefined

  beforeEach(() => {
    mockedSpawn.mockReset()
    resetJavaShimCacheForTests()
    originalJavaHome = process.env['JAVA_HOME']
    originalPath = process.env['PATH']
  })

  afterEach(() => {
    if (originalJavaHome === undefined) {
      delete process.env['JAVA_HOME']
    } else {
      process.env['JAVA_HOME'] = originalJavaHome
    }
    process.env['PATH'] = originalPath
  })

  it('returns silently and leaves the environment untouched when java is on PATH', async () => {
    mockedSpawn.mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: '',
    } as SpawnResolution)
    await expect(ensureJavaOnPath()).resolves.toBeUndefined()
    expect(process.env['JAVA_HOME']).toBe(originalJavaHome)
    expect(process.env['PATH']).toBe(originalPath)
  })

  it('throws an actionable error when java is missing', async () => {
    mockedSpawn.mockRejectedValue(new Error('java not found'))
    await expect(ensureJavaOnPath()).rejects.toThrow(/Java is required/)
    // No env mutation on failure.
    expect(process.env['JAVA_HOME']).toBe(originalJavaHome)
    expect(process.env['PATH']).toBe(originalPath)
  })

  it('is idempotent on success: subsequent calls do not re-probe', async () => {
    mockedSpawn.mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: '',
    } as SpawnResolution)
    await ensureJavaOnPath()
    await ensureJavaOnPath()
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
  })

  it('re-throws on every call when java remains missing', async () => {
    mockedSpawn.mockRejectedValue(new Error('java not found'))
    await expect(ensureJavaOnPath()).rejects.toThrow(/Java is required/)
    await expect(ensureJavaOnPath()).rejects.toThrow(/Java is required/)
    expect(mockedSpawn).toHaveBeenCalledTimes(2)
  })
})
