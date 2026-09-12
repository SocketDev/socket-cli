/**
 * Integration tests for `socket scan` root command.
 *
 * Tests the scan management root command for creating and managing security
 * scans.
 *
 * Test Coverage:
 *
 * - Help text display and subcommand listing
 * - Dry-run behavior validation
 * - Subcommand routing
 *
 * Available Subcommands:
 *
 * - Create: Create new security scan
 * - Del: Delete scan
 * - Diff: Compare scans
 * - Github: GitHub integration
 * - List: List scans
 * - Metadata: View scan metadata
 * - Reach: Reachability analysis
 * - Report: Generate scan reports
 * - Setup: Setup scan configuration
 * - View: View scan details
 *
 * Related Files:
 *
 * - Src/commands/scan/cmd-scan.mts - Root command definition
 * - Src/commands/scan/cmd-scan-*.mts - Subcommands
 */

import { describe, expect } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { expectDryRunOutput } from '../../helpers/output-assertions.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket scan', async () => {
  cmdit(
    ['scan', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Manage Socket scans

          Usage
              $ socket scan <command>
          
            Commands
              create                      Create a new Socket scan and report
              del                         Delete a scan
              diff                        See what changed between two Scans
              list                        List the scans for an organization
              metadata                    Get a scan's metadata
              report                      Check whether a scan result passes the organizational policies (security, license)
              setup                       Start interactive configurator to customize default flag values for \`socket scan\` in this dir
              view                        View the raw results of a scan
          
            Options
          
              --no-banner                 Hide the Socket banner
              --no-spinner                Hide the console spinner
              --quiet                     Route non-essential output (status, progress, warnings) to stderr so stdout carries only the payload. Implied by --json and --markdown."
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket scan\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket scan`')
    },
  )

  cmdit(
    ['scan', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
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
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket scan\`, cwd: <redacted>
        [DryRun]: No-op, call a sub-command; ok"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
