import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(),
}))

import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  buildMetadataCqueryArgv,
  parseCqueryJsonproto,
  runMetadataCqueryForRepo,
  versionlessCoordinate,
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

// Build a single-rule envelope with the given attributes. Keeps the
// edge-resolution fixtures compact.
function ruleEnvelope(
  rules: Array<{
    name: string
    ruleClass?: string
    coord?: string
    deps?: string[]
    exports?: string[]
    runtimeDeps?: string[]
  }>,
): string {
  return JSON.stringify({
    results: rules.map(r => {
      const attribute: unknown[] = []
      if (r.coord) {
        attribute.push({
          name: 'maven_coordinates',
          type: 'STRING',
          stringValue: r.coord,
        })
      }
      if (r.deps) {
        attribute.push({
          name: 'deps',
          type: 'LABEL_LIST',
          stringListValue: r.deps,
        })
      }
      if (r.exports) {
        attribute.push({
          name: 'exports',
          type: 'LABEL_LIST',
          stringListValue: r.exports,
        })
      }
      if (r.runtimeDeps) {
        attribute.push({
          name: 'runtime_deps',
          type: 'LABEL_LIST',
          stringListValue: r.runtimeDeps,
        })
      }
      return {
        target: {
          type: 'RULE',
          rule: {
            name: r.name,
            ruleClass: r.ruleClass ?? 'jvm_import',
            attribute,
          },
        },
      }
    }),
  })
}

describe('versionlessCoordinate', () => {
  it('strips only the trailing version, preserving packaging/classifier', () => {
    expect(versionlessCoordinate('g:a:1.0')).toBe('g:a')
    expect(versionlessCoordinate('g:a:aar:1.0')).toBe('g:a:aar')
    expect(versionlessCoordinate('g:a:jar:linux-x86_64:1.0')).toBe(
      'g:a:jar:linux-x86_64',
    )
  })

  it('returns coordinates with no version segment unchanged', () => {
    expect(versionlessCoordinate('g:a')).toBe('g:a')
  })
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
    expect(argv).toContain('--keep_going')
    expect(argv).toContain('--lockfile_mode=off')
    const expr = argv.find(a => a.includes('attr("tags"'))
    expect(expr).toContain('attr("tags", "\\bmaven_coordinates=", @maven//...)')
    expect(expr).toContain('attr("maven_coordinates", ".+", @maven//...)')
    // maven_url selector dropped: those rules carry no coordinate.
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
    const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
      ENVELOPE_FIXTURE,
      'maven',
      '',
    )
    expect(artifacts).toHaveLength(2)
    expect(unresolvedLabels).toEqual([])
    const first = artifacts[0]!
    expect(first.mavenCoordinates).toBe('androidx.annotation:annotation:1.8.2')
    expect(first.ruleKind).toBe('jvm_import')
    expect(first.ruleName).toBe('androidx_annotation_annotation')
    expect(first.sourceRepo).toBe('maven')
    expect(first.deps).toEqual([])

    const second = artifacts[1]!
    expect(second.mavenCoordinates).toBe('com.example:plain:1.0')
    expect(second.ruleKind).toBe('java_library')
    expect(second.ruleName).toBe('plain_lib')
  })

  it('emits workspace:<rel>+repo:<name> provenance via sourceRepo when workspaceRelPath is set', () => {
    const { artifacts } = parseCqueryJsonproto(
      ENVELOPE_FIXTURE,
      'maven',
      'examples/dagger',
    )
    expect(artifacts[0]?.sourceRepo).toBe('examples/dagger:maven')
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
    const { artifacts } = parseCqueryJsonproto(snakeCase, 'maven', '')
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.mavenCoordinates).toBe('com.example:snake:2.0')
    expect(artifacts[0]?.ruleKind).toBe('kt_jvm_import')
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
    const { artifacts } = parseCqueryJsonproto(streamed, 'maven', '')
    expect(artifacts.map(a => a.mavenCoordinates)).toEqual(['g:a:1', 'g:b:2'])
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
    expect(parseCqueryJsonproto(noCoord, 'maven', '').artifacts).toEqual([])
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
    const { artifacts } = parseCqueryJsonproto(conflicting, 'maven', '')
    expect(artifacts[0]?.mavenCoordinates).toBe('g:direct:1')
  })

  it('returns [] on empty stdout', () => {
    expect(parseCqueryJsonproto('', 'maven', '').artifacts).toEqual([])
    expect(parseCqueryJsonproto('   \n\n', 'maven', '').artifacts).toEqual([])
  })

  describe('dependency-edge resolution', () => {
    it('resolves a simple deps edge to a versionless coordinate', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:junit_junit',
          coord: 'junit:junit:4.13.2',
          deps: ['@maven//:org_hamcrest_hamcrest_core'],
        },
        {
          name: '@maven//:org_hamcrest_hamcrest_core',
          coord: 'org.hamcrest:hamcrest-core:1.3',
        },
      ])
      const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
        stdout,
        'maven',
        '',
      )
      expect(unresolvedLabels).toEqual([])
      const junit = artifacts.find(a => a.ruleName === 'junit_junit')!
      expect(junit.deps).toEqual(['org.hamcrest:hamcrest-core'])
    })

    it('resolves an exports-only edge', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:a',
          coord: 'g:a:1',
          exports: ['@maven//:b'],
        },
        { name: '@maven//:b', coord: 'g:b:1' },
      ])
      const { artifacts } = parseCqueryJsonproto(stdout, 'maven', '')
      expect(artifacts.find(a => a.ruleName === 'a')!.deps).toEqual(['g:b'])
    })

    it('drops a dep label to a non-maven target without counting it', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:a',
          coord: 'g:a:1',
          deps: ['@platforms//os:linux', ':src', '//pkg:thing'],
        },
      ])
      const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
        stdout,
        'maven',
        '',
      )
      // `//pkg:thing` is a Bazel package-relative target, not a coordinate.
      expect(artifacts[0]!.deps).toEqual([])
      expect(unresolvedLabels).toEqual([])
    })

    it('skips a selected non-coordinate rule (not emitted as an artifact)', () => {
      const stdout = ruleEnvelope([
        { name: '@maven//:no_coords_rule', ruleClass: 'java_library' },
      ])
      expect(parseCqueryJsonproto(stdout, 'maven', '').artifacts).toEqual([])
    })

    it('flips partial when a dep points at a hub-prefixed target not in the selected set (apparent form)', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:a',
          coord: 'g:a:1',
          deps: ['@maven//:missing'],
        },
      ])
      const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
        stdout,
        'maven',
        '',
      )
      expect(artifacts[0]!.deps).toEqual([])
      expect(unresolvedLabels).toEqual(['@maven//:missing'])
    })

    it('flips partial for an unresolved hub-prefixed dep in bzlmod-canonical form', () => {
      const canonical = '@@rules_jvm_external++maven+maven//'
      const stdout = ruleEnvelope([
        {
          name: `${canonical}:a`,
          coord: 'g:a:1',
          deps: [`${canonical}:missing`],
        },
      ])
      const { unresolvedLabels } = parseCqueryJsonproto(stdout, 'maven', '')
      expect(unresolvedLabels).toEqual([`${canonical}:missing`])
    })

    it('resolves by full label and flips partial only on ambiguous suffix-only matches', () => {
      // Two coordinate-bearing targets in different packages share the bare
      // name `:widget`. A dep label that full-matches one resolves; a dep
      // label that only suffix-matches (ambiguous) flips partial.
      const stdout = ruleEnvelope([
        {
          name: '@maven//pkg1:widget',
          coord: 'g:widget1:1',
        },
        {
          name: '@maven//pkg2:widget',
          coord: 'g:widget2:1',
        },
        {
          name: '@maven//:consumer',
          coord: 'g:consumer:1',
          // Full-match resolves to widget1; bare-suffix-only is ambiguous.
          deps: ['@maven//pkg1:widget', '@maven//other:widget'],
        },
      ])
      const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
        stdout,
        'maven',
        '',
      )
      const consumer = artifacts.find(a => a.ruleName === 'consumer')!
      expect(consumer.deps).toEqual(['g:widget1'])
      expect(unresolvedLabels).toEqual(['@maven//other:widget'])
    })

    it('keeps the :aar segment on classifier/aar artifacts and matches inbound edges', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:consumer',
          coord: 'g:consumer:1',
          deps: ['@maven//:androidx_test_monitor'],
        },
        {
          name: '@maven//:androidx_test_monitor',
          coord: 'androidx.test:monitor:aar:1.7.2',
        },
      ])
      const { artifacts } = parseCqueryJsonproto(stdout, 'maven', '')
      const monitor = artifacts.find(
        a => a.ruleName === 'androidx_test_monitor',
      )!
      // Key keeps the :aar packaging segment.
      expect(versionlessCoordinate(monitor.mavenCoordinates)).toBe(
        'androidx.test:monitor:aar',
      )
      const consumer = artifacts.find(a => a.ruleName === 'consumer')!
      expect(consumer.deps).toEqual(['androidx.test:monitor:aar'])
    })

    it('unions deps, exports, and runtime_deps', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:a',
          coord: 'g:a:1',
          deps: ['@maven//:b'],
          exports: ['@maven//:c'],
          runtimeDeps: ['@maven//:d'],
        },
        { name: '@maven//:b', coord: 'g:b:1' },
        { name: '@maven//:c', coord: 'g:c:1' },
        { name: '@maven//:d', coord: 'g:d:1' },
      ])
      const { artifacts } = parseCqueryJsonproto(stdout, 'maven', '')
      expect(artifacts.find(a => a.ruleName === 'a')!.deps.sort()).toEqual([
        'g:b',
        'g:c',
        'g:d',
      ])
    })
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
    expect(r.unresolvedLabels).toEqual([])
    expect(r.stderr).toBe('')
  })

  it('returns status:partial on a clean run with unresolved hub-prefixed edges', async () => {
    const stdout = ruleEnvelope([
      { name: '@maven//:a', coord: 'g:a:1', deps: ['@maven//:missing'] },
    ])
    // @ts-ignore — narrow return shape for the test.
    mocked.mockResolvedValueOnce({ code: 0, stdout, stderr: '' })
    const r = await runMetadataCqueryForRepo({
      opts: { bin: 'bazel', cwd: '/r', invocationFlags: [] },
      repoName: 'maven',
      timeoutMs: 60_000,
      workspaceRelPath: '',
      workspaceRoot: '/r',
    })
    expect(r.status).toBe('partial')
    expect(r.unresolvedLabels).toEqual(['@maven//:missing'])
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

  it('returns status:partial when spawn REJECTS on a non-zero exit but stdout still parses (production --keep_going)', async () => {
    // The registry spawn rejects on non-zero exit, so a real --keep_going
    // partial lands in the catch block, not the resolved path above.
    mocked.mockRejectedValueOnce(
      Object.assign(new Error('command failed'), {
        code: 1,
        stdout: ENVELOPE_FIXTURE,
        stderr: 'WARNING: analysis failed for some targets\n',
      }),
    )
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

  it('returns status:timeout when spawn is killed on timeout (killed=true + SIGTERM)', async () => {
    // The real registry spawn does not set `timedOut`; on a `timeout` it kills
    // the child, so Node populates `killed: true` and `signal: 'SIGTERM'`.
    // Mock that shape so the test pins the behaviour real spawn produces.
    mocked.mockRejectedValueOnce(
      Object.assign(new Error('command timed out'), {
        code: null,
        killed: true,
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
