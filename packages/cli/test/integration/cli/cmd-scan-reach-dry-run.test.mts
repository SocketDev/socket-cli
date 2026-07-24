/**
 * Integration tests for `socket scan reach` dry-run mode.
 *
 * Tests reachability analysis in dry-run mode: help output, the basic
 * dry-run bail, and single/combined flag validation. The flag-combination
 * and output-format cases live in
 * test/integration/cli/cmd-scan-reach-dry-run-flags.test.mts.
 *
 * Test Coverage: - Dry-run behavior validation - Flag parsing without execution
 * - Input validation in dry-run mode.
 *
 * Note: This test suite was split from cmd-scan-reach.test.mts to improve test
 * performance and reduce CI bottlenecks.
 *
 * Related Files: - src/commands/scan/cmd-scan-reach.mts - Command definition -
 * test/integration/cli/cmd-scan-reach-validation.test.mts - Validation tests -
 * test/integration/cli/cmd-scan-reach-execution.test.mts - Execution tests.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { expectDryRunOutput } from '../../helpers/output-assertions.mts'
import { cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/scan/reach')

describe('socket scan reach - dry-run tests', async () => {
  cmdit(
    ['scan', 'reach', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Compute tier 1 reachability

          Usage
                $ socket scan reach [options] [CWD=.]
          
              API Token Requirements
                - Quota: 1 unit
                - Permissions: full-scans:create
          
              Options
                --cwd               working directory, defaults to process.cwd()
                --interactive       Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
                --json              Output as JSON
                --markdown          Output as Markdown
                --org               Force override the organization slug, overrides the default org from config
                --output            Path to write the reachability report to (must end with .json). Defaults to .socket.facts.json in the current working directory.
                --quiet             Route non-essential output (status, progress, warnings) to stderr so stdout carries only the payload. Implied by --json and --markdown.
          
              Reachability Options
                --exclude-paths     List of glob patterns to exclude from the scan, including SCA/SBOM manifest discovery and (when --reach is enabled) Tier 1 reachability analysis. Patterns are matched relative to the project root. Bare directory names are auto-extended to recursive globs (e.g. \`tests\` becomes \`tests/**\`). Trailing slashes are stripped. Negation patterns (\`!path\`) are not supported. Accepts a comma-separated value or multiple flags.
                --reach-analysis-memory-limit  The maximum memory in MB to use for the reachability analysis. The default is 8192MB.
                --reach-analysis-timeout  Set timeout for the reachability analysis. Split analysis runs may cause the total scan time to exceed this timeout significantly.
                --reach-concurrency  Set the maximum number of concurrent reachability analysis runs. It is recommended to choose a concurrency level that ensures each analysis run has at least the --reach-analysis-memory-limit amount of memory available. NPM reachability analysis does not support concurrent execution, so the concurrency level is ignored for NPM.
                --reach-debug       Enable debug mode for reachability analysis. Provides verbose logging from the reachability CLI.
                --reach-disable-analytics  Disable reachability analytics sharing with Socket. Also disables caching-based optimizations.
                --reach-ecosystems  List of ecosystems to conduct reachability analysis on, as either a comma separated value or as multiple flags. Defaults to all ecosystems.
                --reach-enable-analysis-splitting  Enable analysis splitting, allowing Coana to split reachability analysis into multiple runs per workspace.
                --reach-exclude-paths  List of paths to exclude from reachability analysis, as either a comma separated value or as multiple flags.
                --reach-min-severity  Set the minimum severity of vulnerabilities to analyze. Supported severities are info, low, moderate, high and critical.
                --reach-skip-cache  Skip caching-based optimizations. By default, the reachability analysis will use cached configurations from previous runs to speed up the analysis.
                --reach-use-only-pregenerated-sboms  When using this option, the scan is created based only on pre-generated CDX and SPDX files in your project.
                --reach-use-unreachable-from-precomputation  Use unreachable information from precomputation to improve analysis accuracy.
          
              Runs the Socket reachability analysis without creating a scan in Socket.
              The output is written to .socket.facts.json in the current working directory
              unless the --output flag is specified.
          
              Note: Manifest files are uploaded to Socket's backend services because the
              reachability analysis requires creating a Software Bill of Materials (SBOM)
              from these files before the analysis can run.
          
              Examples
                $ socket scan reach
                $ socket scan reach ./proj
                $ socket scan reach ./proj --reach-ecosystems npm,pypi
                $ socket scan reach --output custom-report.json
                $ socket scan reach ./proj --output ./reports/analysis.json"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket scan reach\`, cwd: <redacted>"
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

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stderr)

      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket scan reach\`, cwd: <redacted>


        [DryRun]: Would execute reachability analysis

          Command: coana
          Arguments: --target [PROJECT] --org fakeOrg

          Run without --dry-run to execute this command."
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
      expect(stdout).toMatchInlineSnapshot(`""`)
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
      expect(output).toContain('(saw: "invalid-ecosystem")')
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
      '--exclude-paths',
      'node_modules,dist',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --exclude-paths with comma-separated values',
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
      '--exclude-paths',
      'node_modules',
      '--exclude-paths',
      'dist',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple --exclude-paths flags',
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
      '--exclude-paths',
      'build',
      '--reach-exclude-paths',
      'node_modules,dist',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --exclude-paths together with --reach-exclude-paths',
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
      '--exclude-paths',
      '!tests/keep',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should reject --exclude-paths negation patterns',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        "--exclude-paths does not support negation patterns. Got: '!tests/keep'.",
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )
})
