import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildMetadataCqueryArgv } from './bazel-cquery.mts'
import {
  _internalArgvBuilders,
  buildMavenProbeFor,
  buildPypiProbeFor,
  runBazelModShowMavenExtension,
  runBazelModShowPipExtension,
  runBazelModShowVisibleRepos,
  runBazelQuery,
} from './bazel-query-runner.mts'

import type { BazelQueryOptions } from './bazel-query-runner.mts'

describe('Bazel query arguments', () => {
  const opts: BazelQueryOptions = {
    bin: 'bazel',
    cwd: '/repo',
    invocationFlags: ['--noenable_bzlmod', '--enable_workspace'],
    bazelRc: 'C:\\config files\\custom.bazelrc',
    bazelOutputBase: 'C:\\output base',
    outputUserRoot: 'C:\\short root',
    bazelFlags: '--config=ci --define="path=C:\\Program Files\\data"',
  }
  const startup = [
    `--bazelrc=${opts.bazelRc}`,
    `--output_user_root=${opts.outputUserRoot}`,
    `--output_base=${opts.bazelOutputBase}`,
  ]

  it('puts startup flags before every subcommand and keeps user flags intact', () => {
    const {
      buildBazelArgv,
      buildBazelModShowMavenExtensionArgv,
      buildBazelModShowPipExtensionArgv,
      buildBazelModShowVisibleReposArgv,
      buildBazelProbeCqueryArgv,
    } = _internalArgvBuilders
    const invocations = [
      buildBazelArgv('q', opts),
      buildBazelProbeCqueryArgv('maven', opts),
      buildMetadataCqueryArgv('maven', opts),
      buildBazelModShowMavenExtensionArgv(opts),
      buildBazelModShowPipExtensionArgv(opts),
      buildBazelModShowVisibleReposArgv(opts),
    ]
    for (const argv of invocations) {
      expect(argv.slice(0, startup.length)).toEqual(startup)
      expect(argv.slice(-2)).toEqual([
        '--config=ci',
        '--define=path=C:\\Program Files\\data',
      ])
    }
  })

  it('keeps query expressions and workspace flags as separate arguments', () => {
    const expression = 'attr("tags", ".+", @maven//:*)'
    expect(_internalArgvBuilders.buildBazelArgv(expression, opts)).toEqual([
      ...startup,
      'query',
      '--lockfile_mode=off',
      '--noshow_progress',
      ...opts.invocationFlags,
      expression,
      '--output=build',
      '--config=ci',
      '--define=path=C:\\Program Files\\data',
    ])
  })
})

describe('Bazel query processes', () => {
  let cwd: string
  let bin: string
  let opts: BazelQueryOptions

  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'bazel query ')))
    bin = path.join(cwd, 'arguments.cjs')
    writeFileSync(
      bin,
      'process.stdout.write(JSON.stringify({ args: process.argv.slice(2), marker: process.env.BAZEL_QUERY_MARKER, cwd: process.cwd() }))\n',
    )
    opts = {
      bin,
      cwd,
      invocationFlags: [],
      env: { BAZEL_QUERY_MARKER: 'supplied environment' },
    }
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5 })
  })

  it('runs a query in the supplied workspace and environment', async () => {
    const result = await runBazelQuery('q', opts)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      args: [
        'query',
        '--lockfile_mode=off',
        '--noshow_progress',
        'q',
        '--output=build',
      ],
      marker: 'supplied environment',
      cwd,
    })
  })

  it('runs the Maven extension command without updating lockfiles', async () => {
    const result = await runBazelModShowMavenExtension(opts)
    expect(JSON.parse(result.stdout)).toMatchObject({
      args: [
        'mod',
        'show_extension',
        '@rules_jvm_external//:extensions.bzl%maven',
        '--lockfile_mode=off',
        '--extension_usages=<root>',
      ],
    })
  })

  it('runs the Python extension command without updating lockfiles', async () => {
    const result = await runBazelModShowPipExtension(opts)
    expect(JSON.parse(result.stdout)).toMatchObject({
      args: [
        'mod',
        'show_extension',
        '@rules_python//python/extensions:pip.bzl%pip',
        '--lockfile_mode=off',
        '--extension_usages=<root>',
      ],
    })
  })

  it('uses the root repository mapping command', async () => {
    const result = await runBazelModShowVisibleRepos(opts)
    expect(JSON.parse(result.stdout)).toMatchObject({
      args: ['mod', 'dump_repo_mapping', '', '--output=json'],
    })
  })

  it('probes Maven hubs with a lightweight cquery', async () => {
    const result = await buildMavenProbeFor(opts)('maven')
    expect(JSON.parse(result.stdout)).toMatchObject({
      args: [
        'cquery',
        '--lockfile_mode=off',
        '--noshow_progress',
        '@maven//...',
        '--output=label',
        '--keep_going',
      ],
    })
  })

  it('probes Python hubs with a hub-wide query', async () => {
    const result = await buildPypiProbeFor(opts)('pypi')
    expect(JSON.parse(result.stdout)).toMatchObject({
      args: [
        'query',
        '--lockfile_mode=off',
        '--noshow_progress',
        '@pypi//...',
        '--output=build',
      ],
    })
  })

  it('preserves exit status and output from a failed process', async () => {
    writeFileSync(
      bin,
      'process.stdout.write("partial output")\nprocess.stderr.write("download failed: HTTP 503")\nprocess.exitCode = 42\n',
    )
    expect(await runBazelQuery('q', opts)).toEqual({
      code: 42,
      stdout: 'partial output',
      stderr: 'download failed: HTTP 503',
    })
    expect(await buildMavenProbeFor(opts)('maven')).toEqual({
      code: 42,
      stdout: 'partial output',
      stderr: 'download failed: HTTP 503',
    })
  })

  it('reports process startup failures', async () => {
    expect(
      await runBazelQuery('q', { ...opts, bin: path.join(cwd, 'missing') }),
    ).toMatchObject({ code: -1, stdout: '' })
  })
})
