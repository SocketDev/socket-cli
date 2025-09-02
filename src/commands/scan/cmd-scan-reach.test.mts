import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket scan reach', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['scan', 'reach', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Compute tier 1 reachability

          Usage
            $ socket scan reach [options] [CWD=.]

          API Token Requirements
            - Quota: 1 unit
            - Permissions: full-scans:create

          Options
            --cwd               working directory, defaults to process.cwd()
            --json              Output result as json
            --markdown          Output result as markdown
            --org               Force override the organization slug, overrides the default org from config

          Reachability Options
            --reach-analysis-memory-limit  The maximum memory in MB to use for the reachability analysis. The default is 8192MB.
            --reach-analysis-timeout  Set timeout for the reachability analysis. Split analysis runs may cause the total scan time to exceed this timeout significantly.
            --reach-disable-analytics  Disable reachability analytics sharing with Socket. Also disables caching-based optimizations.
            --reach-ecosystems  List of ecosystems to conduct reachability analysis on, as either a comma separated value or as multiple flags. Defaults to all ecosystems.
            --reach-exclude-paths  List of paths to exclude from reachability analysis, as either a comma separated value or as multiple flags.
            --reach-skip-cache  Skip caching-based optimizations. By default, the reachability analysis will use cached configurations from previous runs to speed up the analysis.

          Runs the Socket reachability analysis without creating a scan in Socket.
          The output is written to .socket.facts.json in the current working directory.

          Note: Manifest files are uploaded to Socket's backend services because the
          reachability analysis requires creating a Software Bill of Materials (SBOM)
          from these files before the analysis can run.

          Examples
            $ socket scan reach
            $ socket scan reach ./proj
            $ socket scan reach ./proj --reach-ecosystems npm,pypi"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan reach\`, cwd: <redacted>"
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
      '--dry-run',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, --org: fakeOrg
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan reach\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--org',
      'fakeOrg',
      '--reach-disable-analytics',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-disable-analytics flag',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--reach-analysis-memory-limit',
      '4096',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-analysis-memory-limit flag',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--reach-analysis-timeout',
      '3600',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-analysis-timeout flag',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--reach-ecosystems',
      'npm,pypi',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-ecosystems with comma-separated values',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--reach-ecosystems',
      'npm',
      '--reach-ecosystems',
      'pypi',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple --reach-ecosystems flags',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
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
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail with invalid ecosystem',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Invalid ecosystem: "invalid-ecosystem"')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--reach-exclude-paths',
      'node_modules,dist',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-exclude-paths with comma-separated values',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--reach-exclude-paths',
      'node_modules',
      '--reach-exclude-paths',
      'dist',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple --reach-exclude-paths flags',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
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
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept all reachability flags together',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--reach-analysis-memory-limit',
      '1',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept minimal positive memory limit',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--reach-ecosystems',
      'npm',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should handle single ecosystem flag',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--reach-exclude-paths',
      'path1',
      '--reach-exclude-paths',
      'path2',
      '--reach-exclude-paths',
      'path3',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept many exclude paths flags',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
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
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple different ecosystems',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--reach-analysis-memory-limit',
      '1024',
      '--reach-analysis-timeout',
      '300',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept custom memory limit and timeout values',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
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
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when mixed valid and invalid ecosystems are provided',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Invalid ecosystem: "invalid1"')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--json',
      '--markdown',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when both json and markdown output flags are used',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('The json and markdown flags cannot be both set')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--json',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept json output flag alone',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
      '--markdown',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept markdown output flag alone',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--dry-run',
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
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept comprehensive reachability configuration in dry-run',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd, {
        cwd: '/tmp',
      })
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
