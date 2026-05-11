/**
 * Unit tests for convertGradleToMaven.
 *
 * Spawns gradlew with an init script that emits "POM file copied to: <path>"
 * lines on stdout. Tests cover bin/cwd existence warnings, stderr/exit-code
 * handling, pom collection, --verbose paths, and exception handling.
 *
 * Related Files:
 * - src/commands/manifest/convert-gradle-to-maven.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.hoisted(() => vi.fn(() => true))

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  default: {
    existsSync: mockExistsSync,
  },
}))

const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
}))
const mockSpawn = vi.hoisted(() => vi.fn())
const mockSpinner = vi.hoisted(() => ({
  start: vi.fn(),
  successAndStop: vi.fn(),
  failAndStop: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))
vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
}))
vi.mock('@socketsecurity/lib/spinner', () => ({
  getDefaultSpinner: () => mockSpinner,
}))

vi.mock('../../../../src/constants/paths.mts', () => ({
  distPath: '/dist',
}))

import { convertGradleToMaven } from '../../../../src/commands/manifest/convert-gradle-to-maven.mts'

const baseOpts = {
  bin: 'gradlew',
  cwd: '/proj',
  gradleOpts: [],
  outputKind: 'text' as const,
  verbose: false,
}

describe('convertGradleToMaven', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockExistsSync.mockReturnValue(true)
  })

  it('warns when bin does not exist', async () => {
    mockExistsSync.mockImplementation((p: string) => !p.includes('gradlew'))
    mockSpawn.mockResolvedValueOnce({
      code: 0,
      stdout: 'POM file copied to: /proj/foo.pom\n',
      stderr: '',
    })

    await convertGradleToMaven(baseOpts)

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('executable could not be found'),
    )
  })

  it('warns when cwd does not exist', async () => {
    mockExistsSync.mockImplementation((p: string) => p.includes('gradlew'))
    mockSpawn.mockResolvedValueOnce({
      code: 0,
      stdout: 'POM file copied to: /proj/foo.pom\n',
      stderr: '',
    })

    await convertGradleToMaven(baseOpts)

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('src dir could not be found'),
    )
  })

  it('returns failure when gradle exits non-zero', async () => {
    mockSpawn.mockResolvedValueOnce({
      code: 1,
      stdout: '',
      stderr: 'compile error',
    })

    const result = await convertGradleToMaven(baseOpts)

    expect(result.ok).toBe(false)
    expect(process.exitCode).toBe(1)
    if (!result.ok) {
      expect(result.message).toContain('exited with exit code 1')
      expect(result.cause).toBe('compile error')
    }
  })

  it('parses POM file copied to: lines from stdout', async () => {
    mockSpawn.mockResolvedValueOnce({
      code: 0,
      stdout:
        'noise line\nPOM file copied to: /proj/a.pom\nPOM file copied to: /proj/b.pom\nmore noise\n',
      stderr: '',
    })

    const result = await convertGradleToMaven(baseOpts)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.files).toEqual(['/proj/a.pom', '/proj/b.pom'])
      expect(result.data.type).toBe('gradle')
    }
  })

  it('handles Buffer stdout/stderr by decoding to utf8', async () => {
    mockSpawn.mockResolvedValueOnce({
      code: 0,
      stdout: Buffer.from('POM file copied to: /proj/foo.pom\n'),
      stderr: Buffer.from(''),
    })

    const result = await convertGradleToMaven(baseOpts)

    expect(result.ok).toBe(true)
  })

  it('logs verbose stdout when --verbose is set', async () => {
    mockSpawn.mockResolvedValueOnce({
      code: 0,
      stdout: 'POM file copied to: /proj/foo.pom\n',
      stderr: '',
    })

    await convertGradleToMaven({ ...baseOpts, verbose: true })

    expect(mockLogger.group).toHaveBeenCalledWith('[VERBOSE] gradle stdout:')
  })

  it('logs verbose pre-execution args when --verbose', async () => {
    mockSpawn.mockResolvedValueOnce({
      code: 0,
      stdout: 'POM file copied to: /proj/foo.pom\n',
      stderr: '',
    })

    await convertGradleToMaven({ ...baseOpts, verbose: true })

    expect(mockLogger.log).toHaveBeenCalledWith(
      '[VERBOSE] Executing:',
      ['gradlew'],
      ', args:',
      expect.any(Array),
    )
  })

  it('skips text-mode logging in json mode', async () => {
    mockSpawn.mockResolvedValueOnce({
      code: 0,
      stdout: 'POM file copied to: /proj/foo.pom\n',
      stderr: '',
    })

    await convertGradleToMaven({ ...baseOpts, outputKind: 'json' })

    expect(mockLogger.success).not.toHaveBeenCalled()
  })

  it('returns failure when spawn throws', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('command failed'))

    const result = await convertGradleToMaven(baseOpts)

    expect(result.ok).toBe(false)
    expect(process.exitCode).toBe(1)
  })

  it('logs verbose error when --verbose and spawn throws', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('command failed'))

    await convertGradleToMaven({ ...baseOpts, verbose: true })

    expect(mockLogger.group).toHaveBeenCalledWith('[VERBOSE] error:')
  })

  it('errors with helpful message when spawn returns null', async () => {
    mockSpawn.mockResolvedValueOnce(undefined)

    const result = await convertGradleToMaven(baseOpts)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toContain('spawn returned no output')
    }
  })

  it('forwards gradleOpts into the args array', async () => {
    mockSpawn.mockResolvedValueOnce({
      code: 0,
      stdout: 'POM file copied to: /proj/foo.pom\n',
      stderr: '',
    })

    await convertGradleToMaven({
      ...baseOpts,
      gradleOpts: ['--info', '--stacktrace'],
    })

    const args = mockSpawn.mock.calls[0]?.[1]
    expect(args).toEqual(
      expect.arrayContaining(['--info', '--stacktrace', 'pom']),
    )
  })

  it('does not log stderr group on non-zero exit when --verbose', async () => {
    mockSpawn.mockResolvedValueOnce({
      code: 1,
      stdout: '',
      stderr: 'gradle err',
    })

    await convertGradleToMaven({ ...baseOpts, verbose: true })

    // verbose mode prints the error in the stdout group, not a separate stderr group.
    expect(mockLogger.group).not.toHaveBeenCalledWith('stderr:')
  })

  it('logs separate stderr group when not verbose and exit non-zero', async () => {
    mockSpawn.mockResolvedValueOnce({
      code: 1,
      stdout: '',
      stderr: 'gradle err',
    })

    await convertGradleToMaven(baseOpts)

    expect(mockLogger.group).toHaveBeenCalledWith('stderr:')
  })
})
