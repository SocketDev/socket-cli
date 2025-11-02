import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_DRY_RUN, FLAG_HELP } from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

const _fixtureBaseDir = path.join(testPath, 'fixtures/commands/scan/reach')

describe('socket scan reach - dry-run tests', async () => {
  cmdit(
    ['scan', 'reach', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
            at exportsNotFound (node:internal/modules/esm/resolve:313:10)
            at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
            at resolveExports (node:internal/modules/cjs/loader:678:36)
            at Module._findPath (node:internal/modules/cjs/loader:745:31)
            at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
            at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
            at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
            at Module._load (node:internal/modules/cjs/loader:1226:37)
            at TracingChannel.traceSync (node:diagnostics_channel:328:14)
            at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
          code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
        }"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan reach`',
      )
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
            at exportsNotFound (node:internal/modules/esm/resolve:313:10)
            at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
            at resolveExports (node:internal/modules/cjs/loader:678:36)
            at Module._findPath (node:internal/modules/cjs/loader:745:31)
            at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
            at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
            at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
            at Module._load (node:internal/modules/cjs/loader:1226:37)
            at TracingChannel.traceSync (node:diagnostics_channel:328:14)
            at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
          code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
        }"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--org',
      'fakeOrg',
      '--reach-disable-analytics',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-disable-analytics flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-analysis-memory-limit',
      '4096',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-analysis-memory-limit flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-analysis-timeout',
      '3600',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-analysis-timeout flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-ecosystems',
      'npm,pypi',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-ecosystems with comma-separated values',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-ecosystems',
      'npm',
      '--reach-ecosystems',
      'pypi',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple --reach-ecosystems flags',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(code, 'should exit with code 0').toBe(0)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--reach-ecosystems',
      'invalid-ecosystem',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail with invalid ecosystem',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Invalid ecosystem: "invalid-ecosystem"')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-exclude-paths',
      'node_modules,dist',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-exclude-paths with comma-separated values',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-exclude-paths',
      'node_modules',
      '--reach-exclude-paths',
      'dist',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple --reach-exclude-paths flags',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-disable-analytics',
      '--reach-analysis-memory-limit',
      '4096',
      '--reach-analysis-timeout',
      '3600',
      '--reach-ecosystems',
      'npm,pypi',
      '--reach-exclude-paths',
      'node_modules,dist',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept all reachability flags together',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-analysis-memory-limit',
      '1',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept minimal positive memory limit',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-ecosystems',
      'npm',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle single ecosystem flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-exclude-paths',
      'path1',
      '--reach-exclude-paths',
      'path2',
      '--reach-exclude-paths',
      'path3',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept many exclude paths flags',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-ecosystems',
      'npm',
      '--reach-ecosystems',
      'pypi',
      '--reach-ecosystems',
      'cargo',
      '--reach-ecosystems',
      'maven',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple different ecosystems',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-analysis-memory-limit',
      '1024',
      '--reach-analysis-timeout',
      '300',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept custom memory limit and timeout values',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--reach-ecosystems',
      'npm,invalid1,pypi,invalid2',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when mixed valid and invalid ecosystems are provided',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Invalid ecosystem: "invalid1"')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--json',
      '--markdown',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when both json and markdown output flags are used',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('The json and markdown flags cannot be both set')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--json',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept json output flag alone',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--markdown',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept markdown output flag alone',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  it(
    'should accept comprehensive reachability configuration in dry-run: `scan reach --dry-run --reach-analysis-memory-limit 16384 --reach-analysis-timeout 7200 --reach-ecosystems npm --reach-exclude-paths node_modules --org fakeOrg --config {"apiToken":"fakeToken"}`',
    { timeout: 30_000 },
    async () => {
      const cmd = [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--reach-analysis-memory-limit',
        '16384',
        '--reach-analysis-timeout',
        '7200',
        '--reach-ecosystems',
        'npm',
        '--reach-exclude-paths',
        'node_modules',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fakeToken"}',
      ]
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
