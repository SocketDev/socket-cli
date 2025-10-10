import path from 'node:path'

import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_JSON,
  FLAG_MARKDOWN,
  FLAG_ORG,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/scan/create')

describe('socket scan create', async () => {
  const { binCliPath } = constants

  cmdit(
    ['scan', 'create', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan create`',
      )
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
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
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
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
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
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
      expect(code, 'should exit with code 0 when all flags are valid').toBe(0)
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
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
      expect(code, 'should exit with code 0 when all flags are valid').toBe(0)
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
      '--reach',
      '--reach-ecosystems',
      'npm,pypi,cargo',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when --reach-ecosystems is used with comma-separated values',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
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
      'target',
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
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
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
      expect(output).toContain('Invalid ecosystem: "invalid-ecosystem"')
      expect(
        code,
        'should exit with non-zero code when invalid ecosystem is provided',
      ).not.toBe(0)
    },
  )

  cmdit(
    ['scann', 'create', FLAG_HELP],
    'should suggest similar command for typos',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Unknown command "scann". Did you mean "scan"?')
      expect(
        code,
        'should exit with non-zero code when command is not found',
      ).toBe(2)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      path.join(fixtureBaseDir, 'nonexistent'),
      FLAG_ORG,
      'test-org',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show helpful error message for directories with no manifest files',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('found no eligible files to scan')
      expect(output).toContain('docs.socket.dev')
      expect(output).toContain('manifest-file-detection-in-socket')
      expect(
        code,
        'should exit with non-zero code when no files found',
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
      '--reach',
      '--reach-analysis-memory-limit',
      '1',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with minimal positive reachability memory limit',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  // TODO: Fix test failure - scan create with zero timeout (unlimited)
  // Test expects exit code 0 but actual behavior may differ
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
      '--reach',
      '--reach-analysis-timeout',
      '0',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with zero timeout (unlimited)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
      expect(code, 'should exit with code 0').toBe(0)
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
      expect(output).toContain('Invalid ecosystem: "invalid"')
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
      'target',
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
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
      expect(code, 'should exit with code 0 when all flags are valid').toBe(0)
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
      '--reach',
      '--json',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with --reach and --json output format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
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
      '--reach',
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with --reach and --markdown output format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
      expect(code, 'should exit with code 0').toBe(0)
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
      'target',
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
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for scan:
          create - Create a security scan with project awareness
          list - List recent scans
          view - View scan details
          del - Delete a scan"
      `)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
