/**
 * Unit tests for the Bazel query runner (argv shapes, spawn normalization,
 * spinner + verbose trace behavior).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))

// Mock the logger so verbose traces are capturable without TTY noise.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock the spinner so tests don't render to TTY.
const mockSpinner = vi.hoisted(() => ({
  failAndStop: vi.fn(),
  start: vi.fn(),
  successAndStop: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/spinner/default'), () => ({
  getDefaultSpinner: () => mockSpinner,
}))

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  buildMavenProbeFor,
  buildPypiProbeFor,
  runBazelModShowMavenExtension,
  runBazelModShowPipExtension,
  runBazelModShowVisibleRepos,
  runBazelQuery,
} from '../../../../../src/commands/manifest/bazel/bazel-query-runner.mts'

type SpawnResolution = Awaited<ReturnType<typeof spawn>>

function spawnResolution(
  code: number,
  stdout: string,
  stderr: string,
): SpawnResolution {
  return { code, stderr, stdout } as SpawnResolution
}

describe('runBazelQuery', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    mockSpinner.start.mockClear()
    mockSpinner.successAndStop.mockClear()
    mockSpinner.failAndStop.mockClear()
    mockLogger.log.mockClear()
    mocked.mockResolvedValue(spawnResolution(0, 'ok', ''))
  })

  it('builds the standard query argv shape', async () => {
    await runBazelQuery('attr("tags", ".+", @maven//:*)', {
      bin: '/usr/local/bin/bazel',
      cwd: '/repo',
      invocationFlags: [],
    })
    const call = mocked.mock.calls[0]!
    expect(call[0]).toBe('/usr/local/bin/bazel')
    const argv = call[1] as string[]
    expect(argv[0]).toBe('query')
    expect(argv).toContain('--lockfile_mode=off')
    expect(argv).toContain('--noshow_progress')
    expect(argv).toContain('attr("tags", ".+", @maven//:*)')
    expect(argv).toContain('--output=build')
  })

  it('forwards bazelRc as a startup flag BEFORE query', async () => {
    await runBazelQuery('q', {
      bazelRc: '/path/to/.bazelrc',
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv[0]).toBe('--bazelrc=/path/to/.bazelrc')
    expect(argv.indexOf('--bazelrc=/path/to/.bazelrc')).toBeLessThan(
      argv.indexOf('query'),
    )
  })

  it('forwards outputUserRoot as a startup flag BEFORE the subcommand', async () => {
    await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
      outputUserRoot: '/tmp/socket-bazel-xyz',
    })
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toContain('--output_user_root=/tmp/socket-bazel-xyz')
    expect(
      argv.indexOf('--output_user_root=/tmp/socket-bazel-xyz'),
    ).toBeLessThan(argv.indexOf('query'))
  })

  it('forwards bazelOutputBase as a startup flag BEFORE query', async () => {
    await runBazelQuery('q', {
      bazelOutputBase: '/tmp/output-base',
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toContain('--output_base=/tmp/output-base')
    expect(argv.indexOf('--output_base=/tmp/output-base')).toBeLessThan(
      argv.indexOf('query'),
    )
  })

  it('appends invocationFlags after queryFlags', async () => {
    await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: ['--noenable_bzlmod', '--enable_workspace'],
    })
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toContain('--noenable_bzlmod')
    expect(argv).toContain('--enable_workspace')
  })

  it('splits bazelFlags string on whitespace and appends', async () => {
    await runBazelQuery('q', {
      bazelFlags: '--config=ci --keep_going',
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toContain('--config=ci')
    expect(argv).toContain('--keep_going')
  })

  it('forwards env to spawn when provided', async () => {
    const env = { ...process.env, BAZEL_BENCH: 'yes' }
    await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      env,
      invocationFlags: [],
    })
    expect(mocked.mock.calls[0]![2]).toMatchObject({ cwd: '/r', env })
  })

  it('returns spawn result fields', async () => {
    mocked.mockResolvedValueOnce(spawnResolution(0, 'OUT', 'ERR'))
    const r = await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    expect(r).toEqual({ code: 0, stderr: 'ERR', stdout: 'OUT' })
  })

  it('stops spinner as failure when spawn resolves with non-zero code', async () => {
    mocked.mockResolvedValueOnce(spawnResolution(7, '', 'boom'))
    const r = await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    expect(r).toEqual({ code: 7, stderr: 'boom', stdout: '' })
    expect(mockSpinner.successAndStop).not.toHaveBeenCalled()
    expect(mockSpinner.failAndStop).toHaveBeenCalled()
  })

  it('normalizes rejected spawn errors with code, stdout, and stderr', async () => {
    mocked.mockRejectedValueOnce(
      Object.assign(new Error('bazel failed'), {
        code: 42,
        stderr: 'ERR',
        stdout: 'OUT',
      }),
    )
    const r = await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    expect(r).toEqual({ code: 42, stderr: 'ERR', stdout: 'OUT' })
    expect(mockSpinner.failAndStop).toHaveBeenCalled()
  })

  it('preserves stderr from a rejected spawn so the caller sees the diagnostic', async () => {
    mocked.mockRejectedValueOnce(
      Object.assign(new Error('bazel resolution failed'), {
        code: 1,
        stderr: 'download failed: HTTP/2 503',
        stdout: '',
      }),
    )
    const r = await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    expect(r).toEqual({
      code: 1,
      stderr: 'download failed: HTTP/2 503',
      stdout: '',
    })
  })

  it('normalizes rejected spawn errors without numeric code or status to -1', async () => {
    mocked.mockRejectedValueOnce(
      Object.assign(new Error('spawn failed'), {
        code: 'ENOENT',
        stderr: 'missing bazel',
        stdout: '',
      }),
    )
    const r = await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    expect(r).toEqual({ code: -1, stderr: 'missing bazel', stdout: '' })
  })

  it('emits bounded subprocess trace when verbose is true', async () => {
    mocked.mockResolvedValueOnce(spawnResolution(7, 'OUT', 'ERR'))
    await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
      verbose: true,
    })
    const text = mockLogger.log.mock.calls
      .map(args => args.map(a => String(a)).join(' '))
      .join('\n')
    expect(text).toContain('bazel subprocess trace')
    expect(text).toContain('bazel stderr tail')
    expect(text).toContain('bazel-query-failed')
  })
})

describe('runBazelModShowMavenExtension', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    mocked.mockResolvedValue(
      spawnResolution(
        0,
        '## @@rules_jvm_external+//:extensions.bzl%maven:\n',
        '',
      ),
    )
  })

  it('uses the rules_jvm_external maven extension target', async () => {
    await runBazelModShowMavenExtension({
      bin: 'bazel',
      cwd: '/repo',
      invocationFlags: [],
    })
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toEqual([
      'mod',
      'show_extension',
      '@rules_jvm_external//:extensions.bzl%maven',
      '--lockfile_mode=off',
      '--extension_usages=<root>',
    ])
  })

  it('pins the lockfile read-only so the scan never rewrites MODULE.bazel.lock', async () => {
    await runBazelModShowMavenExtension({
      bin: 'bazel',
      cwd: '/repo',
      invocationFlags: [],
    })
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toContain('--lockfile_mode=off')
  })

  it('threads outputUserRoot ahead of the subcommand', async () => {
    await runBazelModShowMavenExtension({
      bin: 'bazel',
      cwd: '/repo',
      invocationFlags: [],
      outputUserRoot: '/tmp/socket-bazel-abc',
    })
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toEqual([
      '--output_user_root=/tmp/socket-bazel-abc',
      'mod',
      'show_extension',
      '@rules_jvm_external//:extensions.bzl%maven',
      '--lockfile_mode=off',
      '--extension_usages=<root>',
    ])
  })
})

describe('runBazelModShowVisibleRepos', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    mocked.mockResolvedValue(spawnResolution(0, '{}', ''))
  })

  it('uses the Bazel 7-compatible root repo mapping command', async () => {
    await runBazelModShowVisibleRepos({
      bin: 'bazel',
      cwd: '/repo',
      invocationFlags: [],
    })
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toEqual(['mod', 'dump_repo_mapping', '', '--output=json'])
    expect(argv).not.toContain('--all_visible_repos')
    expect(argv).not.toContain('--output=streamed_jsonproto')
  })
})

describe('runBazelModShowPipExtension', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    mocked.mockResolvedValue(spawnResolution(0, 'pip.parse()', ''))
  })

  it('uses the rules_python pip extension usage command', async () => {
    await runBazelModShowPipExtension({
      bin: 'bazel',
      cwd: '/repo',
      invocationFlags: [],
    })
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toEqual([
      'mod',
      'show_extension',
      '@rules_python//python/extensions:pip.bzl%pip',
      '--lockfile_mode=off',
      '--extension_usages=<root>',
    ])
  })
})

describe('buildMavenProbeFor', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    mocked.mockResolvedValue(
      spawnResolution(0, '@maven//:foo\n@maven//:bar\n', ''),
    )
  })

  it('builds the lightweight presence-check cquery for a repo name', async () => {
    const probe = buildMavenProbeFor({
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const result = await probe('my_maven_repo')
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toContain('cquery')
    expect(argv).toContain('@my_maven_repo//...')
    expect(argv).toContain('--output=label')
    expect(argv).toContain('--keep_going')
    expect(result).toEqual({
      code: 0,
      stderr: '',
      stdout: '@maven//:foo\n@maven//:bar\n',
    })
  })

  it('threads outputUserRoot into the probe argv', async () => {
    const probe = buildMavenProbeFor({
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
      outputUserRoot: '/tmp/x',
    })
    await probe('maven')
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv[0]).toBe('--output_user_root=/tmp/x')
    expect(argv).toContain('@maven//...')
  })

  it('returns the full result triple including stderr (tri-state classifier needs it)', async () => {
    mocked.mockResolvedValueOnce(
      spawnResolution(
        1,
        '',
        "ERROR: No repository visible as '@nope' from main repository\n",
      ),
    )
    const probe = buildMavenProbeFor({
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const result = await probe('nope')
    expect(result).toEqual({
      code: 1,
      stderr: "ERROR: No repository visible as '@nope' from main repository\n",
      stdout: '',
    })
  })
})

describe('buildPypiProbeFor', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    mocked.mockResolvedValue(
      spawnResolution(0, '@pypi//requests:pkg\n@pypi//flask:pkg\n', ''),
    )
  })

  it('builds a hub-wide query for a pip hub name', async () => {
    const probe = buildPypiProbeFor({
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const result = await probe('pypi')
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toContain('@pypi//...')
    expect(result).toEqual({
      code: 0,
      stderr: '',
      stdout: expect.stringContaining('@pypi//requests:pkg'),
    })
  })

  it('returns the full triple when the hub has no :pkg targets', async () => {
    mocked.mockReset()
    mocked.mockResolvedValue(spawnResolution(0, '', ''))
    const probe = buildPypiProbeFor({
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const result = await probe('empty_hub')
    expect(result).toEqual({ code: 0, stderr: '', stdout: '' })
  })
})
