import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { resolveBazelBinary } from './bazel-bin-detect.mts'
import {
  cleanUpBazelOutputRoot,
  makeBazelOutputUserRoot,
} from './bazel-cleanup.mts'
import { ensureJavaOnPath } from './bazel-java-shim.mts'
import {
  BazelTimeoutError,
  getBazelEnvironment,
  spawnBazel,
} from './bazel-process.mts'
import { provisionPythonShim } from './bazel-python-shim.mts'
import { extractBazelToMaven } from './extract_bazel_to_maven.mts'

const FIXTURES = path.resolve(
  import.meta.dirname,
  '../../../../test/fixtures/manifest-bazel/native',
)
const EXPECTED: unknown = JSON.parse(
  readFileSync(path.join(FIXTURES, 'maven.expected.json'), 'utf8'),
)
const CLI =
  process.env['SOCKET_BAZEL_TEST_CLI'] ??
  path.resolve(import.meta.dirname, '../../../../bin/cli.js')

describe.skipIf(process.env['SOCKET_BAZEL_INTEGRATION'] !== '1')(
  'native Bazel Maven extraction',
  () => {
    let scratch: string
    let outputParent: string
    let bin: string

    beforeAll(async () => {
      const env = getBazelEnvironment()
      const cwd = process.cwd()
      bin = await resolveBazelBinary(
        process.env['SOCKET_BAZEL_TEST_BIN'],
        env,
        cwd,
      )
      ensureJavaOnPath(env, cwd)
      const python = await provisionPythonShim(env, cwd)
      if (python.shimDir) {
        rmSync(python.shimDir, { recursive: true, force: true })
      }
      expect(existsSync(CLI)).toBe(true)
      const version = await spawnBazel(bin, ['--version'], {
        cwd: path.join(FIXTURES, 'bzlmod'),
      })
      console.log({
        bazel: version.stdout.trim(),
        bin,
        cli: CLI,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      })
    })

    beforeEach(() => {
      scratch = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), 'bazel native ')),
      )
      const parent = process.env['SOCKET_BAZEL_OUTPUT_ROOT'] ?? os.tmpdir()
      mkdirSync(parent, { recursive: true })
      outputParent = mkdtempSync(path.join(parent, 'native-'))
    })

    afterEach(() => {
      rmSync(scratch, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      })
      rmSync(outputParent, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      })
    })

    for (const mode of ['bzlmod', 'workspace']) {
      const manifestName =
        mode === 'bzlmod'
          ? 'socket_fixture_maven_install.json'
          : 'maven_install.json'
      it(`extracts direct and transitive Maven dependencies in ${mode} mode`, async () => {
        const workspace = path.join(scratch, 'project with spaces')
        cpSync(path.join(FIXTURES, mode), workspace, { recursive: true })
        const marker = path.join(
          workspace,
          mode === 'bzlmod' ? 'MODULE.bazel' : 'WORKSPACE',
        )
        const original = readFileSync(marker, 'utf8')
        const out = path.join(scratch, 'generated manifests')
        const result = await extractBazelToMaven({
          bazelFlags: '--repo_env=FIXTURE_PATH="C:\\Program Files\\fixture"',
          bazelOutputBase: undefined,
          bazelRc: undefined,
          bin,
          cwd: scratch,
          out,
          env: { SOCKET_BAZEL_OUTPUT_ROOT: outputParent },
          verbose: true,
        })
        expect(result.status).toBe('complete')
        expect(result.artifactCount).toBe(2)
        expect(result.manifestPaths).toHaveLength(1)
        const manifest = result.manifestPaths[0]
        if (!manifest) {
          throw new Error('Expected a Maven manifest')
        }
        expect(JSON.parse(readFileSync(manifest, 'utf8'))).toMatchObject(
          EXPECTED,
        )
        expect(readFileSync(marker, 'utf8')).toBe(original)
        expect(existsSync(path.join(workspace, 'MODULE.bazel.lock'))).toBe(
          false,
        )
        expect(readdirSync(outputParent)).toEqual([])
      }, 600_000)

      it(`runs the packaged CLI in ${mode} mode`, async () => {
        const workspace = path.join(scratch, 'packaged project')
        cpSync(path.join(FIXTURES, mode), workspace, { recursive: true })
        const out = path.join(scratch, 'packaged output')
        const result = await spawn(
          process.execPath,
          [CLI, 'manifest', 'bazel', '--bazel', bin, '--out', out, workspace],
          {
            cwd: scratch,
            env: getBazelEnvironment({
              SOCKET_BAZEL_OUTPUT_ROOT: outputParent,
            }),
            timeout: 600_000,
          },
        )
        expect(result.code).toBe(0)
        expect(
          JSON.parse(readFileSync(path.join(out, manifestName), 'utf8')),
        ).toMatchObject(EXPECTED)
        expect(readdirSync(outputParent)).toEqual([])
      }, 600_000)

      it(`uses the Maven auto-manifest layout in ${mode} mode`, async () => {
        const workspace = path.join(scratch, 'auto project')
        cpSync(path.join(FIXTURES, mode), workspace, { recursive: true })
        const result = await extractBazelToMaven({
          bazelFlags: undefined,
          bazelOutputBase: undefined,
          bazelRc: undefined,
          bin,
          cwd: workspace,
          out: scratch,
          outLayout: 'flat',
          env: { SOCKET_BAZEL_OUTPUT_ROOT: outputParent },
          verbose: true,
        })
        expect(result.status).toBe('complete')
        expect(
          JSON.parse(
            readFileSync(
              path.join(scratch, '.socket-auto-manifest', manifestName),
              'utf8',
            ),
          ),
        ).toMatchObject(EXPECTED)
        expect(readdirSync(outputParent)).toEqual([])
      }, 600_000)
    }
  },
)

const SLOW_REPOSITORY_RULE = `def _slow_repo_impl(ctx):
    if ctx.os.name.startswith("windows"):
        ctx.execute(["cmd.exe", "/c", "ping -n 301 127.0.0.1 > nul"], timeout = 600)
    else:
        ctx.execute(["sleep", "300"], timeout = 600)
    ctx.file("BUILD.bazel", 'filegroup(name = "fixture")\\n')

slow_repo = repository_rule(implementation = _slow_repo_impl)
`

describe.skipIf(process.env['SOCKET_BAZEL_INTEGRATION'] !== '1')(
  'native Bazel process supervision',
  () => {
    let bin: string
    let workspace: string
    let root: string

    beforeAll(async () => {
      bin = await resolveBazelBinary(
        process.env['SOCKET_BAZEL_TEST_BIN'],
        getBazelEnvironment(),
        process.cwd(),
      )
    })

    beforeEach(() => {
      workspace = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), 'bazel supervision ')),
      )
      cpSync(
        path.join(FIXTURES, 'workspace', '.bazelversion'),
        path.join(workspace, '.bazelversion'),
      )
      writeFileSync(path.join(workspace, 'BUILD.bazel'), '')
      writeFileSync(path.join(workspace, 'slow.bzl'), SLOW_REPOSITORY_RULE)
      writeFileSync(
        path.join(workspace, 'WORKSPACE'),
        'load("//:slow.bzl", "slow_repo")\n\nslow_repo(name = "slow")\n',
      )
      // A shutdown that exits successfully while the server keeps running.
      writeFileSync(
        path.join(workspace, '.bazelrc'),
        'common --noenable_bzlmod\nshutdown --iff_heap_size_greater_than=1000000\n',
      )
      root = makeBazelOutputUserRoot(getBazelEnvironment(), workspace)
    })

    afterEach(() => {
      rmSync(workspace, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      })
      rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    })

    const launchers: Array<[string, () => string]> = [
      [
        'JavaScript',
        () => {
          const launcher = path.join(workspace, 'launcher.cjs')
          writeFileSync(
            launcher,
            `const { spawnSync } = require('node:child_process')
const result = spawnSync(${JSON.stringify(bin)}, process.argv.slice(2), { stdio: 'inherit' })
process.exit(result.status ?? 1)
`,
          )
          return launcher
        },
      ],
    ]
    if (process.platform === 'win32') {
      launchers.push([
        'batch',
        () => {
          const launcher = path.join(workspace, 'launcher.cmd')
          writeFileSync(launcher, `@"${bin}" %*\r\n`)
          return launcher
        },
      ])
    }

    async function expectServerStopped(launcher: string): Promise<void> {
      const server = readdirSync(root)
        .map(entry => path.join(root, entry, 'server', 'server.pid.txt'))
        .filter(file => existsSync(file))
        .map(file => Number(readFileSync(file, 'utf8')))
      expect(server).toHaveLength(1)
      expect(
        await cleanUpBazelOutputRoot(
          root,
          new Map([
            [
              workspace,
              {
                bin: launcher,
                cwd: workspace,
                invocationFlags: [],
                outputUserRoot: root,
              },
            ],
          ]),
        ),
      ).toBe(true)
      expect(existsSync(root)).toBe(false)
      expect(() => process.kill(server[0] ?? 0, 0)).toThrow()
    }

    for (const [kind, writeLauncher] of launchers) {
      it(`stops Bazel behind a ${kind} launcher when a query times out`, async () => {
        const launcher = writeLauncher()
        const startedAt = Date.now()
        await expect(
          spawnBazel(
            launcher,
            [`--output_user_root=${root}`, 'query', '@slow//:fixture'],
            { cwd: workspace, timeout: 30_000 },
          ),
        ).rejects.toBeInstanceOf(BazelTimeoutError)
        expect(Date.now() - startedAt).toBeLessThan(60_000)
        await expectServerStopped(launcher)
      }, 180_000)

      it(`stops Bazel behind a ${kind} launcher when cancelled`, async () => {
        const launcher = writeLauncher()
        const controller = new AbortController()
        const startedAt = Date.now()
        const query = spawnBazel(
          launcher,
          [`--output_user_root=${root}`, 'query', '@slow//:fixture'],
          { cwd: workspace, signal: controller.signal },
        )
        setTimeout(() => controller.abort(), 30_000)
        await expect(query).rejects.toMatchObject({ name: 'AbortError' })
        expect(Date.now() - startedAt).toBeLessThan(60_000)
        await expectServerStopped(launcher)
      }, 180_000)
    }
  },
)
