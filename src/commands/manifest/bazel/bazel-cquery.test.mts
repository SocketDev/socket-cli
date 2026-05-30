import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(),
}))

import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  buildMetadataCqueryArgv,
  parseCqueryJsonproto,
  runMetadataCqueryForRepo,
} from './bazel-cquery.mts'

// Sample envelope shape Bazel 5+ emits: `{ "results": [ { "target": {...} } ] }`.
// Two rules: one with `tags`/`maven_coordinates` (rules_jvm_external shape)
// and one with the direct `maven_coordinates` attr only (Bazel-native shape).
const ENVELOPE_FIXTURE = JSON.stringify({
  results: [
    {
      target: {
        type: 'RULE',
        rule: {
          name: '@maven//:androidx_annotation_annotation',
          ruleClass: 'jvm_import',
          attribute: [
            {
              name: 'maven_coordinates',
              type: 'STRING',
              stringValue: 'androidx.annotation:annotation:1.8.2',
            },
            {
              name: 'maven_url',
              type: 'STRING',
              stringValue:
                'https://maven.google.com/androidx/annotation/annotation/1.8.2/annotation-1.8.2.jar',
            },
            {
              name: 'tags',
              type: 'STRING_LIST',
              stringListValue: [
                'maven_coordinates=androidx.annotation:annotation:1.8.2',
                'maven_repository=https://maven.google.com',
              ],
            },
          ],
        },
      },
    },
    {
      target: {
        type: 'RULE',
        rule: {
          name: '@maven//:plain_lib',
          ruleClass: 'java_library',
          attribute: [
            {
              name: 'tags',
              type: 'STRING_LIST',
              stringListValue: ['maven_coordinates=com.example:plain:1.0'],
            },
          ],
        },
      },
    },
  ],
})

describe('buildMetadataCqueryArgv', () => {
  it('builds the union expression and the documented flag set', () => {
    const argv = buildMetadataCqueryArgv('maven', {
      bin: 'bazel',
      cwd: '/repo',
      invocationFlags: [],
    })
    expect(argv).toContain('cquery')
    expect(argv).toContain('--output=jsonproto')
    expect(argv).toContain(
      '--proto:output_rule_attrs=tags,maven_coordinates,maven_url',
    )
    expect(argv).toContain('--keep_going')
    expect(argv).toContain('--lockfile_mode=off')
    const expr = argv.find(a => a.includes('attr("tags"'))
    expect(expr).toContain('attr("tags", "\\bmaven_coordinates=", @maven//...)')
    expect(expr).toContain('attr("maven_coordinates", ".+", @maven//...)')
    expect(expr).toContain('attr("maven_url", ".+", @maven//...)')
  })

  it('threads outputUserRoot, bazelRc, and bazelOutputBase as startup flags before cquery', () => {
    const argv = buildMetadataCqueryArgv('maven', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
      bazelRc: '/etc/bazel.rc',
      outputUserRoot: '/tmp/socket-bazel-1',
      bazelOutputBase: '/tmp/output-base',
    })
    expect(argv[0]).toBe('--bazelrc=/etc/bazel.rc')
    expect(argv[1]).toBe('--output_user_root=/tmp/socket-bazel-1')
    expect(argv[2]).toBe('--output_base=/tmp/output-base')
    expect(argv[3]).toBe('cquery')
  })

  it('appends user --bazel-flag args AFTER the standard cquery flags', () => {
    const argv = buildMetadataCqueryArgv('maven', {
      bin: 'bazel',
      cwd: '/r',
      invocationFlags: [],
      bazelFlags: '--config=ci --repo_env=SCALA_VERSION=2.13.18',
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

describe('parseCqueryJsonproto', () => {
  it('parses Bazel-5+ envelope shape and returns one artifact per rule', () => {
    const out = parseCqueryJsonproto(ENVELOPE_FIXTURE, 'maven', '')
    expect(out).toHaveLength(2)
    const first = out[0]!
    expect(first.mavenCoordinates).toBe('androidx.annotation:annotation:1.8.2')
    expect(first.mavenUrl).toBe(
      'https://maven.google.com/androidx/annotation/annotation/1.8.2/annotation-1.8.2.jar',
    )
    expect(first.ruleKind).toBe('jvm_import')
    expect(first.ruleName).toBe('androidx_annotation_annotation')
    expect(first.sourceRepo).toBe('maven')

    const second = out[1]!
    expect(second.mavenCoordinates).toBe('com.example:plain:1.0')
    expect(second.ruleKind).toBe('java_library')
    expect(second.ruleName).toBe('plain_lib')
  })

  it('emits workspace:<rel>+repo:<name> provenance via sourceRepo when workspaceRelPath is set', () => {
    const out = parseCqueryJsonproto(
      ENVELOPE_FIXTURE,
      'maven',
      'examples/dagger',
    )
    expect(out[0]?.sourceRepo).toBe('examples/dagger:maven')
  })

  it('falls back to snake_case payload keys (string_value, string_list_value)', () => {
    const snakeCase = JSON.stringify({
      results: [
        {
          target: {
            type: 'RULE',
            rule: {
              name: '@maven//:snake_case_artifact',
              rule_class: 'kt_jvm_import',
              attribute: [
                {
                  name: 'tags',
                  type: 'STRING_LIST',
                  string_list_value: [
                    'maven_coordinates=com.example:snake:2.0',
                  ],
                },
              ],
            },
          },
        },
      ],
    })
    const out = parseCqueryJsonproto(snakeCase, 'maven', '')
    expect(out).toHaveLength(1)
    expect(out[0]?.mavenCoordinates).toBe('com.example:snake:2.0')
    expect(out[0]?.ruleKind).toBe('kt_jvm_import')
  })

  it('falls back to per-line jsonproto stream when envelope is absent', () => {
    const streamed = [
      JSON.stringify({
        type: 'RULE',
        rule: {
          name: '@maven//:a',
          ruleClass: 'jvm_import',
          attribute: [
            {
              name: 'maven_coordinates',
              type: 'STRING',
              stringValue: 'g:a:1',
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'RULE',
        rule: {
          name: '@maven//:b',
          ruleClass: 'jvm_import',
          attribute: [
            {
              name: 'maven_coordinates',
              type: 'STRING',
              stringValue: 'g:b:2',
            },
          ],
        },
      }),
    ].join('\n')
    const out = parseCqueryJsonproto(streamed, 'maven', '')
    expect(out.map(a => a.mavenCoordinates)).toEqual(['g:a:1', 'g:b:2'])
  })

  it('skips rules with no recoverable maven coordinate', () => {
    const noCoord = JSON.stringify({
      results: [
        {
          target: {
            type: 'RULE',
            rule: {
              name: '@maven//:no_coord',
              ruleClass: 'java_library',
              attribute: [
                {
                  name: 'tags',
                  type: 'STRING_LIST',
                  stringListValue: ['some_other_tag=value'],
                },
              ],
            },
          },
        },
      ],
    })
    expect(parseCqueryJsonproto(noCoord, 'maven', '')).toEqual([])
  })

  it('prefers the direct maven_coordinates attr over the tag fallback', () => {
    const conflicting = JSON.stringify({
      results: [
        {
          target: {
            type: 'RULE',
            rule: {
              name: '@maven//:dual',
              ruleClass: 'jvm_import',
              attribute: [
                {
                  name: 'maven_coordinates',
                  type: 'STRING',
                  stringValue: 'g:direct:1',
                },
                {
                  name: 'tags',
                  type: 'STRING_LIST',
                  stringListValue: ['maven_coordinates=g:via_tag:2'],
                },
              ],
            },
          },
        },
      ],
    })
    const out = parseCqueryJsonproto(conflicting, 'maven', '')
    expect(out[0]?.mavenCoordinates).toBe('g:direct:1')
  })

  it('returns [] on empty stdout', () => {
    expect(parseCqueryJsonproto('', 'maven', '')).toEqual([])
    expect(parseCqueryJsonproto('   \n\n', 'maven', '')).toEqual([])
  })
})

describe('runMetadataCqueryForRepo', () => {
  const mocked = vi.mocked(spawn)

  beforeEach(() => {
    mocked.mockReset()
  })

  it('returns status:ok with parsed artifacts on a clean run', async () => {
    // @ts-ignore — narrow return shape for the test.
    mocked.mockResolvedValueOnce({
      code: 0,
      stdout: ENVELOPE_FIXTURE,
      stderr: '',
    })
    const r = await runMetadataCqueryForRepo({
      opts: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('ok')
    expect(r.artifacts).toHaveLength(2)
    expect(r.stderr).toBe('')
  })

  it('returns status:empty when stdout has no parsed artifacts on exit 0', async () => {
    // @ts-ignore — narrow return shape for the test.
    mocked.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    const r = await runMetadataCqueryForRepo({
      opts: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('empty')
    expect(r.artifacts).toEqual([])
  })

  it('returns status:partial when --keep_going emits non-zero but still parses targets', async () => {
    // Bazel: exit 1 + "Analysis succeeded for only 118 of 122 top-level targets"
    // is the normal --keep_going outcome.
    // @ts-ignore — narrow return shape for the test.
    mocked.mockResolvedValueOnce({
      code: 1,
      stdout: ENVELOPE_FIXTURE,
      stderr: 'WARNING: analysis failed for some targets\n',
    })
    const r = await runMetadataCqueryForRepo({
      opts: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('partial')
    expect(r.artifacts).toHaveLength(2)
  })

  it('returns status:error on non-zero exit with no parsed targets', async () => {
    // @ts-ignore — narrow return shape for the test.
    mocked.mockResolvedValueOnce({
      code: 1,
      stdout: '',
      stderr: 'ERROR: something broke\n',
    })
    const r = await runMetadataCqueryForRepo({
      opts: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('error')
    expect(r.artifacts).toEqual([])
  })

  it('returns status:timeout when spawn rejects with timedOut=true', async () => {
    mocked.mockRejectedValueOnce(
      Object.assign(new Error('command timed out'), {
        code: null,
        timedOut: true,
        stderr: '',
        stdout: '',
      }),
    )
    const r = await runMetadataCqueryForRepo({
      opts: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
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
      opts: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('timeout')
  })

  it('passes workspaceRoot as cwd and outputUserRoot as startup flag', async () => {
    // @ts-ignore — narrow return shape for the test.
    mocked.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    await runMetadataCqueryForRepo({
      opts: {
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
