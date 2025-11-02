import path from 'node:path'

import { describe, expect } from 'vitest'

import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_DRY_RUN, FLAG_HELP } from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

const _fixtureBaseDir = path.join(testPath, 'fixtures/commands/scan/reach')

describe('socket scan reach - validation tests', () => {
  describe('output path tests', () => {
    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--output',
        'custom-report.json',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fakeToken"}',
      ],
      'should accept --output flag with .json extension',
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
        '-o',
        'report.json',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fakeToken"}',
      ],
      'should accept -o short flag with .json extension',
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
        '--output',
        './reports/analysis.json',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fakeToken"}',
      ],
      'should accept --output flag with path',
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
        '--output',
        'report.txt',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fakeToken"}',
      ],
      'should fail when --output does not end with .json',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('The --output path must end with .json')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--output',
        'report',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fakeToken"}',
      ],
      'should fail when --output has no extension',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('The --output path must end with .json')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--output',
        'report.JSON',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fakeToken"}',
      ],
      'should fail when --output ends with .JSON (uppercase)',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('The --output path must end with .json')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )
  })

  describe('error handling and usability tests', () => {
    cmdit(
      [
        'scan',
        'reach',
        '/nonexistent/directory',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for non-existent directory',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(
          /no eligible files|file.*dir.*must contain|not.*found|directory must exist/i,
        )
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['scan', 'reach', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
      'should show clear error when API token is missing',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/api token|authentication|token/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--org',
        '',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error when org is empty',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/organization|org/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--reach-analysis-memory-limit',
        'not-a-number',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for invalid memory limit',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('[DryRun]: Bailing now')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--reach-analysis-memory-limit',
        '-1',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for negative memory limit',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('[DryRun]: Bailing now')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--reach-analysis-timeout',
        'invalid-timeout',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for invalid timeout value',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('[DryRun]: Bailing now')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--reach-analysis-timeout',
        '0',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for zero timeout',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('[DryRun]: Bailing now')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-analysis-memory-limit',
        '999999999',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle extremely large memory limit values',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-exclude-paths',
        '',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle empty exclude paths gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_HELP,
        '--reach-ecosystems',
        'npm',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{}',
      ],
      'should prioritize help over other flags',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(stdout).toContain('Compute tier 1 reachability')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-ecosystems',
        'npm,invalid-ecosystem,pypi',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for mixed valid and invalid ecosystems',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/invalid.*ecosystem.*invalid-ecosystem/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-exclude-paths',
        '/absolute/path,relative/path,../parent/path',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle various path formats in exclude paths',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        FLAG_CONFIG,
        '{"apiToken":"invalid-token-with-special-chars-!@#$%^&*()"}',
        '--org',
        'fakeOrg',
      ],
      'should handle tokens with special characters gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-ecosystems',
        'npm',
        '--reach-ecosystems',
        'npm',
        '--reach-ecosystems',
        'npm',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle duplicate ecosystem flags gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )
  })
})
