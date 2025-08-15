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
            --reach-continue-on-failing-projects  Continue reachability analysis even when some projects/workspaces fail. Default is to crash the CLI at the first failing project/workspace.
            --reach-disable-analytics  Disable reachability analytics sharing with Socket. Also disables caching-based optimizations.
            --reach-ecosystems  List of ecosystems to conduct reachability analysis on, as either a comma separated value or as multiple flags. Defaults to all ecosystems.
            --reach-exclude-paths  List of paths to exclude from reachability analysis, as either a comma separated value or as multiple flags.

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
      '--reach-continue-on-failing-projects',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-continue-on-failing-projects flag',
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
      '--reach-continue-on-failing-projects',
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
})
