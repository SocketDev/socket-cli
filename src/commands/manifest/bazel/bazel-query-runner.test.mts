import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(),
}))

// Mock the spinner so tests don't render to TTY.
vi.mock('../../../constants.mts', () => ({
  default: {
    spinner: {
      start: vi.fn(),
      successAndStop: vi.fn(),
      failAndStop: vi.fn(),
    },
  },
}))

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  buildMavenProbeFor,
  buildPypiProbeFor,
  runBazelModShowMavenExtension,
  runBazelModShowPipExtension,
  runBazelModShowVisibleRepos,
  runBazelQuery,
} from './bazel-query-runner.mts'
import constants from '../../../constants.mts'

describe('runBazelQuery', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    vi.mocked(constants.spinner.start).mockClear()
    vi.mocked(constants.spinner.successAndStop).mockClear()
    vi.mocked(constants.spinner.failAndStop).mockClear()
    // @ts-ignore — spawn return type union; tests only use the three fields.
    mocked.mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' })
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
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
      bazelRc: '/path/to/.bazelrc',
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
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
      bazelOutputBase: '/tmp/output-base',
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
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
      bazelFlags: '--config=ci --keep_going',
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
      invocationFlags: [],
      env,
    })
    expect(mocked.mock.calls[0]![2]).toMatchObject({ cwd: '/r', env })
  })

  it('returns spawn result fields', async () => {
    // @ts-ignore — narrow return shape for the test's purposes.
    mocked.mockResolvedValueOnce({ code: 0, stdout: 'OUT', stderr: 'ERR' })
    const r = await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    expect(r).toEqual({ code: 0, stdout: 'OUT', stderr: 'ERR' })
  })

  it('stops spinner as failure when spawn resolves with non-zero code', async () => {
    // @ts-ignore — narrow return shape for the test's purposes.
    mocked.mockResolvedValueOnce({ code: 7, stdout: '', stderr: 'boom' })
    const r = await runBazelQuery('q', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    expect(r).toEqual({ code: 7, stdout: '', stderr: 'boom' })
    expect(constants.spinner.successAndStop).not.toHaveBeenCalled()
    expect(constants.spinner.failAndStop).toHaveBeenCalled()
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
    expect(r).toEqual({ code: 42, stdout: 'OUT', stderr: 'ERR' })
    expect(constants.spinner.failAndStop).toHaveBeenCalled()
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
      stdout: '',
      stderr: 'download failed: HTTP/2 503',
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
    expect(r).toEqual({ code: -1, stdout: '', stderr: 'missing bazel' })
  })

  it('emits bounded subprocess trace when verbose is true', async () => {
    const logSpy = vi.spyOn(logger, 'log').mockImplementation(() => logger)
    try {
      // @ts-ignore — narrow return shape for the test's purposes.
      mocked.mockResolvedValueOnce({ code: 7, stdout: 'OUT', stderr: 'ERR' })
      await runBazelQuery('q', {
        bin: 'bazel',
        cwd: '/r',
        invocationFlags: [],
        verbose: true,
      })
      const text = logSpy.mock.calls
        .map(args => args.map(a => String(a)).join(' '))
        .join('\n')
      expect(text).toContain('bazel subprocess trace')
      expect(text).toContain('bazel stderr tail')
      expect(text).toContain('bazel-query-failed')
    } finally {
      logSpy.mockRestore()
    }
  })
})

describe('runBazelModShowMavenExtension', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    // @ts-ignore — narrow return shape for the test's purposes.
    mocked.mockResolvedValue({
      code: 0,
      stdout: '## @@rules_jvm_external+//:extensions.bzl%maven:\n',
      stderr: '',
    })
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
      '--extension_usages=<root>',
    ])
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
      '--extension_usages=<root>',
    ])
  })
})

describe('runBazelModShowVisibleRepos', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    // @ts-ignore — narrow return shape for the test's purposes.
    mocked.mockResolvedValue({ code: 0, stdout: '{}', stderr: '' })
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
    // @ts-ignore — narrow return shape for the test's purposes.
    mocked.mockResolvedValue({ code: 0, stdout: 'pip.parse()', stderr: '' })
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
      '--extension_usages=<root>',
    ])
  })
})

describe('buildMavenProbeFor', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    // @ts-ignore — narrow return shape for the test's purposes.
    mocked.mockResolvedValue({
      code: 0,
      stdout: '@maven//:foo\n@maven//:bar\n',
      stderr: '',
    })
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
      stdout: '@maven//:foo\n@maven//:bar\n',
      stderr: '',
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
    // @ts-ignore — narrow return shape for the test's purposes.
    mocked.mockResolvedValueOnce({
      code: 1,
      stdout: '',
      stderr: "ERROR: No repository visible as '@nope' from main repository\n",
    })
    const probe = buildMavenProbeFor({
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const result = await probe('nope')
    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: "ERROR: No repository visible as '@nope' from main repository\n",
    })
  })
})

describe('buildPypiProbeFor', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    // @ts-ignore — narrow return shape for the test's purposes.
    mocked.mockResolvedValue({
      code: 0,
      stdout: '@pypi//requests:pkg\n@pypi//flask:pkg\n',
      stderr: '',
    })
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
      stdout: expect.stringContaining('@pypi//requests:pkg'),
      stderr: '',
    })
  })

  it('returns the full triple when the hub has no :pkg targets', async () => {
    mocked.mockReset()
    // @ts-ignore — narrow return shape for the test's purposes.
    mocked.mockResolvedValue({
      code: 0,
      stdout: '',
      stderr: '',
    })
    const probe = buildPypiProbeFor({
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const result = await probe('empty_hub')
    expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
  })
})
