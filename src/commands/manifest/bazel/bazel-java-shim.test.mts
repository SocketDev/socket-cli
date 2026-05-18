import { execSync } from 'node:child_process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  _resetJavaShimCacheForTests,
  ensureJavaOnPath,
} from './bazel-java-shim.mts'

vi.mock('node:child_process', async () => {
  const actual =
    await vi.importActual<typeof import('node:child_process')>(
      'node:child_process',
    )
  return { ...actual, execSync: vi.fn() }
})

describe('ensureJavaOnPath', () => {
  const mockedExec = vi.mocked(execSync)

  let originalJavaHome: string | undefined
  let originalPath: string | undefined

  beforeEach(() => {
    mockedExec.mockReset()
    _resetJavaShimCacheForTests()
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

  it('returns silently and leaves the environment untouched when java is on PATH', () => {
    mockedExec.mockReturnValue(Buffer.from(''))
    expect(() => ensureJavaOnPath()).not.toThrow()
    expect(process.env['JAVA_HOME']).toBe(originalJavaHome)
    expect(process.env['PATH']).toBe(originalPath)
  })

  it('throws an actionable error when java is missing', () => {
    mockedExec.mockImplementation(() => {
      throw new Error('java not found')
    })
    expect(() => ensureJavaOnPath()).toThrow(/Java is required/)
    // No env mutation on failure.
    expect(process.env['JAVA_HOME']).toBe(originalJavaHome)
    expect(process.env['PATH']).toBe(originalPath)
  })

  it('is idempotent on success: subsequent calls do not re-probe', () => {
    mockedExec.mockReturnValue(Buffer.from(''))
    ensureJavaOnPath()
    ensureJavaOnPath()
    expect(mockedExec).toHaveBeenCalledTimes(1)
  })

  it('re-throws on every call when java remains missing', () => {
    mockedExec.mockImplementation(() => {
      throw new Error('java not found')
    })
    expect(() => ensureJavaOnPath()).toThrow(/Java is required/)
    expect(() => ensureJavaOnPath()).toThrow(/Java is required/)
    expect(mockedExec).toHaveBeenCalledTimes(2)
  })
})
