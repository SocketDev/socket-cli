import { describe, expect } from 'vitest'

import {
  constants,
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_ORG,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket scan create reachability flag validation', async () => {
  const { binCliPath } = constants

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'target',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-disable-analytics',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-disable-analytics is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'target',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-analysis-memory-limit',
      '8192',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when --reach-analysis-memory-limit is used with default value without --reach',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0 when using default value').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'target',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-analysis-memory-limit',
      '4096',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-analysis-memory-limit is used with non-default value without --reach',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'target',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-analysis-timeout',
      '3600',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-analysis-timeout is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'target',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-ecosystems',
      'npm',
      '--reach-ecosystems',
      'pypi',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-ecosystems is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'target',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-exclude-paths',
      'node_modules',
      '--reach-exclude-paths',
      'dist',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-exclude-paths is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'target',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-ecosystems',
      'npm,pypi',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-ecosystems with comma-separated values is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'target',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-exclude-paths',
      'node_modules,dist',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-exclude-paths with comma-separated values is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )
})
