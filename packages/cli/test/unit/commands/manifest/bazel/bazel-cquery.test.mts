/**
 * Unit tests for the per-repo metadata cquery runner: argv shape and outcome
 * classification over a mocked spawn.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  buildMetadataCqueryArgv,
  runMetadataCqueryForRepo,
} from '../../../../../src/commands/manifest/bazel/bazel-cquery.mts'
import { ENVELOPE_FIXTURE, ruleEnvelope } from './cquery-test-fixtures.mts'

type SpawnResolution = Awaited<ReturnType<typeof spawn>>

function spawnResolution(
  code: number,
  stdout: string,
  stderr: string,
): SpawnResolution {
  return { code, stderr, stdout } as SpawnResolution
}

describe('buildMetadataCqueryArgv', () => {
  it('builds the union expression and the documented flag set', () => {
    const argv = buildMetadataCqueryArgv('maven', {
      bin: 'bazel',
      cwd: '/repo',
      invocationFlags: [],
    })
    expect(argv).toContain('cquery')
    expect(argv).toContain('--output=jsonproto')
    expect(argv).toContain('--keep_going')
    expect(argv).toContain('--lockfile_mode=off')
    const expr = argv.find(a => a.includes('attr("tags"'))
    expect(expr).toContain('attr("tags", "\\bmaven_coordinates=", @maven//...)')
    expect(expr).toContain('attr("maven_coordinates", ".+", @maven//...)')
    // maven_url selector left out: those rules carry no coordinate.
    expect(expr).not.toContain('maven_url')
  })

  it('requests the dependency-edge attributes in output_rule_attrs', () => {
    const argv = buildMetadataCqueryArgv('maven', {
      bin: 'bazel',
      cwd: '/repo',
      invocationFlags: [],
    })
    const attrFlag = argv.find(a => a.startsWith('--proto:output_rule_attrs='))!
    expect(attrFlag).toContain('deps')
    expect(attrFlag).toContain('exports')
    expect(attrFlag).toContain('runtime_deps')
    expect(attrFlag).toContain('tags')
    expect(attrFlag).toContain('maven_coordinates')
  })

  it('threads outputUserRoot, bazelRc, and bazelOutputBase as startup flags before cquery', () => {
    const argv = buildMetadataCqueryArgv('maven', {
      bazelOutputBase: '/tmp/output-base',
      bazelRc: '/etc/bazel.rc',
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
      outputUserRoot: '/tmp/socket-bazel-1',
    })
    expect(argv[0]).toBe('--bazelrc=/etc/bazel.rc')
    expect(argv[1]).toBe('--output_user_root=/tmp/socket-bazel-1')
    expect(argv[2]).toBe('--output_base=/tmp/output-base')
    expect(argv[3]).toBe('cquery')
  })

  it('appends user --bazel-flag args AFTER the standard cquery flags', () => {
    const argv = buildMetadataCqueryArgv('maven', {
      bazelFlags: '--config=ci --repo_env=SCALA_VERSION=2.13.18',
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
    })
    const cqueryIdx = argv.indexOf('cquery')
    const userIdx = argv.indexOf('--config=ci')
    expect(userIdx).toBeGreaterThan(cqueryIdx)
    expect(argv).toContain('--repo_env=SCALA_VERSION=2.13.18')
  })

  it('includes invocationFlags between subcommand and target expression', () => {
    const argv = buildMetadataCqueryArgv('maven', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: ['--noenable_bzlmod', '--enable_workspace'],
    })
    expect(argv).toContain('--noenable_bzlmod')
    expect(argv).toContain('--enable_workspace')
  })
})

describe('runMetadataCqueryForRepo', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
  })

  it('returns status:ok with parsed artifacts on a clean run', async () => {
    mocked.mockResolvedValueOnce(spawnResolution(0, ENVELOPE_FIXTURE, ''))
    const r = await runMetadataCqueryForRepo({
      options: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('ok')
    expect(r.artifacts).toHaveLength(2)
    expect(r.unresolvedLabels).toEqual([])
    expect(r.stderr).toBe('')
  })

  it('returns status:partial on a clean run with unresolved hub-prefixed edges', async () => {
    const stdout = ruleEnvelope([
      { name: '@maven//:a', coord: 'g:a:1', deps: ['@maven//:missing'] },
    ])
    mocked.mockResolvedValueOnce(spawnResolution(0, stdout, ''))
    const r = await runMetadataCqueryForRepo({
      options: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('partial')
    expect(r.unresolvedLabels).toEqual(['@maven//:missing'])
  })

  it('returns status:empty when stdout has no parsed artifacts on exit 0', async () => {
    mocked.mockResolvedValueOnce(spawnResolution(0, '', ''))
    const r = await runMetadataCqueryForRepo({
      options: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('empty')
    expect(r.artifacts).toEqual([])
  })

  it('returns status:partial when --keep_going emits non-zero but still parses targets', async () => {
    // Bazel: exit 1 + "Analysis succeeded for only 118 of 122 top-level
    // targets" is the normal --keep_going outcome.
    mocked.mockResolvedValueOnce(
      spawnResolution(
        1,
        ENVELOPE_FIXTURE,
        'WARNING: analysis failed for some targets\n',
      ),
    )
    const r = await runMetadataCqueryForRepo({
      options: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('partial')
    expect(r.artifacts).toHaveLength(2)
  })

  it('returns status:partial when spawn REJECTS on a non-zero exit but stdout still parses (production --keep_going)', async () => {
    // The lib spawn rejects on non-zero exit, so a real --keep_going
    // partial lands in the catch block, not the resolved path above.
    mocked.mockRejectedValueOnce(
      Object.assign(new Error('command failed'), {
        code: 1,
        stderr: 'WARNING: analysis failed for some targets\n',
        stdout: ENVELOPE_FIXTURE,
      }),
    )
    const r = await runMetadataCqueryForRepo({
      options: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('partial')
    expect(r.artifacts).toHaveLength(2)
  })

  it('returns status:error on non-zero exit with no parsed targets', async () => {
    mocked.mockResolvedValueOnce(
      spawnResolution(1, '', 'ERROR: something broke\n'),
    )
    const r = await runMetadataCqueryForRepo({
      options: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('error')
    expect(r.artifacts).toEqual([])
  })

  it('returns status:timeout when spawn is killed on timeout (killed=true + SIGTERM)', async () => {
    // The real lib spawn does not set `timedOut`; on a `timeout` it kills
    // the child, so Node populates `killed: true` and `signal: 'SIGTERM'`.
    // Mock that shape so the test pins the behaviour real spawn produces.
    mocked.mockRejectedValueOnce(
      Object.assign(new Error('command timed out'), {
        code: undefined,
        killed: true,
        signal: 'SIGTERM',
        stderr: '',
        stdout: '',
      }),
    )
    const r = await runMetadataCqueryForRepo({
      options: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('timeout')
    expect(r.artifacts).toEqual([])
  })

  it('returns status:timeout when spawn signals SIGTERM/SIGKILL', async () => {
    mocked.mockRejectedValueOnce(
      Object.assign(new Error('killed'), {
        signal: 'SIGTERM',
        stderr: '',
        stdout: '',
      }),
    )
    const r = await runMetadataCqueryForRepo({
      options: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('timeout')
  })

  it('passes workspaceRoot as cwd and outputUserRoot as startup flag', async () => {
    mocked.mockResolvedValueOnce(spawnResolution(0, '', ''))
    await runMetadataCqueryForRepo({
      options: {
        bin: 'bazel',
        cwd: '/anywhere',
        invocationFlags: [],
        outputUserRoot: '/tmp/socket-bazel-xyz',
      },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/repo/sub',
    })
    const call = mocked.mock.calls[0]!
    expect(call[2]).toMatchObject({ cwd: '/repo/sub', timeout: 60_000 })
    const argv = call[1] as string[]
    expect(argv).toContain('--output_user_root=/tmp/socket-bazel-xyz')
  })
})
