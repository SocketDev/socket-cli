import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_DRY_RUN, FLAG_ORG } from '../../../src/constants.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket scan create with --reach', async () => {
  const binCliPath = getBinCliPath()

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-disable-analytics',
      '--reach-analysis-memory-limit',
      '4096',
      '--reach-analysis-timeout',
      '3600',
      '--reach-ecosystems',
      'npm',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when reachability options are used with --reach',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0 when all flags are valid').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-disable-analytics',
      '--reach-analysis-memory-limit',
      '4096',
      '--reach-analysis-timeout',
      '3600',
      '--reach-ecosystems',
      'npm',
      '--reach-exclude-paths',
      'node_modules',
      '--reach-exclude-paths',
      'dist',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when all reachability options including reachExcludePaths are used with --reach',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0 when all flags are valid').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-ecosystems',
      'npm,pypi,cargo',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when --reach-ecosystems is used with comma-separated values',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'should exit with code 0 when comma-separated values are used',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-exclude-paths',
      'node_modules,dist,build',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when --reach-exclude-paths is used with comma-separated values',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'should exit with code 0 when comma-separated values are used',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-ecosystems',
      'npm,invalid-ecosystem',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-ecosystems contains invalid values',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('(saw: "invalid-ecosystem")')
      expect(
        code,
        'should exit with non-zero code when invalid ecosystem is provided',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-analysis-memory-limit',
      '1',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with minimal positive reachability memory limit',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-analysis-timeout',
      '0',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with zero timeout (unlimited)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-ecosystems',
      'npm,invalid,pypi',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when invalid ecosystem mixed with valid ones in --reach mode',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('(saw: "invalid")')
      expect(
        code,
        'should exit with non-zero code when invalid ecosystem provided',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-ecosystems',
      'npm',
      '--reach-exclude-paths',
      'vendor,build,dist,target',
      '--reach-analysis-memory-limit',
      '16384',
      '--reach-analysis-timeout',
      '7200',
      '--reach-disable-analytics',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with comprehensive reachability configuration',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0 when all flags are valid').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--json',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with --reach and --json output format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with --reach and --markdown output format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--json',
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when both --json and --markdown are used with --reach',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('The json and markdown flags cannot be both set')
      expect(
        code,
        'should exit with non-zero code when conflicting flags are used',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--read-only',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when combining --reach with --read-only',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
