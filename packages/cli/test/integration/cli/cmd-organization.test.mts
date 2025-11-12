/**
 * Integration tests for `socket organization` root command.
 *
 * Tests the organization management root command which provides access
 * to organization-level operations and settings.
 *
 * Test Coverage:
 * - Help text display and subcommand listing
 * - Dry-run behavior validation
 * - Subcommand routing
 *
 * Available Subcommands:
 * - dependencies: View organization dependencies
 * - list: List available organizations
 * - policy: Manage security policies
 * - quota: View API quota usage
 *
 * Related Files:
 * - src/commands/organization/cmd-organization.mts - Root command definition
 * - src/commands/organization/cmd-organization-*.mts - Subcommands
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

describe('socket organization', async () => {
  cmdit(
    ['organization', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Manage Socket organization account details

          Usage
              $ socket organization <command>
          
            Commands
              dependencies                Search for any dependency that is being used in your organization
              list                        List organizations associated with the Socket API token
              policy                      Organization policy details
          
            Options
          
              --no-banner                 Hide the Socket banner
              --no-spinner                Hide the console spinner"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket organization\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket organization`',
      )
    },
  )

  cmdit(
    ['organization', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should be ok with org name and id',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stdout)
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket organization\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
