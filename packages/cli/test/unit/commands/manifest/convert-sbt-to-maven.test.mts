/**
 * Unit tests for convertSbtToMaven.
 *
 * Spawns sbt makePom; collects "Wrote <path>.pom" lines from stdout to
 * determine the produced pom files. Tests cover stderr handling, no-pom
 * detection, single/multi-file stdout output, --verbose logging, and exception
 * handling.
 *
 * Related Files:
 *
 * - Src/commands/manifest/convert-sbt-to-maven.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const mockSafeReadFile = vi.hoisted(() => vi.fn(async () => 'pom-content'))
const mockSpinner = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@socketsecurity/lib-stable/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))
vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: mockSpawn,
}))
vi.mock('@socketsecurity/lib-stable/fs/read-file', () => ({
  safeReadFile: mockSafeReadFile,
}))
vi.mock('@socketsecurity/lib-stable/spinner/default', () => ({
  getDefaultSpinner: () => mockSpinner,
}))

import { convertSbtToMaven } from '../../../../src/commands/manifest/convert-sbt-to-maven.mts'

const baseOpts = {
  bin: 'sbt',
  cwd: '/proj',
  out: 'output.pom.xml',
  outputKind: 'text' as const,
  sbtOpts: [],
  verbose: false,
}

describe('convertSbtToMaven', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('returns error when sbt writes to stderr', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: 'compile failed',
    })

    const result = await convertSbtToMaven(baseOpts)

    expect(result.ok).toBe(false)
    expect(process.exitCode).toBe(1)
  })

  it('returns error when no poms were generated', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'no relevant lines',
      stderr: '',
    })

    const result = await convertSbtToMaven(baseOpts)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('not have generated any poms')
    }
  })

  it('parses Wrote <path>.pom lines from stdout', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/a.pom\nWrote /proj/b.pom\n',
      stderr: '',
    })

    const result = await convertSbtToMaven(baseOpts)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.files).toEqual(['/proj/a.pom', '/proj/b.pom'])
    }
  })

  it('writes single-file pom to stdout when out=- and one pom exists', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: '',
    })

    const result = await convertSbtToMaven({ ...baseOpts, out: '-' })

    expect(result.ok).toBe(true)
    expect(mockSafeReadFile).toHaveBeenCalledWith('/proj/foo.pom')
  })

  it('errors when out=- but multiple poms exist', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/a.pom\nWrote /proj/b.pom\n',
      stderr: '',
    })

    const result = await convertSbtToMaven({ ...baseOpts, out: '-' })

    expect(result.ok).toBe(false)
    expect(process.exitCode).toBe(1)
    if (!result.ok) {
      expect(result.message).toContain('multiple generated files')
    }
  })

  it('repeats the failure header when there are >10 poms with out=-', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Wrote /proj/p${i}.pom`)
    mockSpawn.mockResolvedValueOnce({
      stdout: lines.join('\n') + '\n',
      stderr: '',
    })

    await convertSbtToMaven({ ...baseOpts, out: '-' })

    // logger.fail is called twice — once before the file list, once after.
    expect(mockLogger.fail).toHaveBeenCalledTimes(2)
  })

  it('logs verbose stdout when --verbose is set', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: '',
    })

    await convertSbtToMaven({ ...baseOpts, verbose: true })

    expect(mockLogger.group).toHaveBeenCalledWith('[VERBOSE] sbt stdout:')
  })

  it('skips text-mode logging when outputKind is json', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: '',
    })

    await convertSbtToMaven({ ...baseOpts, outputKind: 'json' })

    expect(mockLogger.success).not.toHaveBeenCalled()
  })

  it('returns failure when spawn throws', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('command failed'))

    const result = await convertSbtToMaven(baseOpts)

    expect(result.ok).toBe(false)
    expect(process.exitCode).toBe(1)
    if (!result.ok) {
      expect(result.cause).toContain('command failed')
    }
  })

  it('logs verbose error details when --verbose and spawn throws', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('command failed'))

    await convertSbtToMaven({ ...baseOpts, verbose: true })

    expect(mockLogger.group).toHaveBeenCalledWith('[VERBOSE] error:')
  })

  it('forwards sbtOpts to the spawn invocation', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: '',
    })

    await convertSbtToMaven({ ...baseOpts, sbtOpts: ['--debug', '--noisy'] })

    expect(mockSpawn).toHaveBeenCalledWith(
      'sbt',
      ['makePom', '--debug', '--noisy'],
      expect.any(Object),
    )
  })
})
