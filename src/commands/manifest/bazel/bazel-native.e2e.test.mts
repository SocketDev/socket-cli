import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { resolveBazelBinary } from './bazel-bin-detect.mts'
import { ensureJavaOnPath } from './bazel-java-shim.mts'
import { getBazelEnvironment, spawnBazel } from './bazel-process.mts'
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
