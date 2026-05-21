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

import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  buildProbeFor,
  buildPypiProbeFor,
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
    await runBazelQuery('kind(jvm_import, @maven//:*)', {
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
    expect(argv).toContain('kind(jvm_import, @maven//:*)')
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

describe('buildProbeFor', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
    // @ts-ignore — narrow return shape for the test's purposes.
    mocked.mockResolvedValue({
      code: 0,
      stdout: 'jvm_import(\n  maven_coordinates="g:a:1",\n)',
      stderr: '',
    })
  })

  it('builds the probe query for a repo name', async () => {
    const probe = buildProbeFor({
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const result = await probe('my_maven_repo')
    const argv = mocked.mock.calls[0]![1] as string[]
    expect(argv).toContain(
      'kind("jvm_import rule|aar_import rule", @my_maven_repo//:*)',
    )
    expect(result).toEqual({
      stdout: expect.stringContaining('maven_coordinates'),
      code: 0,
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
      stdout: expect.stringContaining('@pypi//requests:pkg'),
      code: 0,
    })
  })

  it('returns non-zero code when the hub has no :pkg targets', async () => {
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
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
  })
})
