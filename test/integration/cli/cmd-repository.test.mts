/**
 * Integration tests for `socket repository` root command.
 *
 * Tests the repository management root command for GitHub/GitLab integrations.
 *
 * Test Coverage:
 *
 * - Help text display and subcommand listing
 * - Dry-run behavior validation
 * - Subcommand routing
 *
 * Available Subcommands:
 *
 * - Create: Register new repository
 * - Del: Unregister repository
 * - List: List registered repositories
 * - Update: Update repository settings
 * - View: View repository details
 *
 * Related Files:
 *
 * - Src/commands/repository/cmd-repository.mts - Root command definition
 * - Src/commands/repository/cmd-repository-*.mts - Subcommands
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

describe('socket repository', async () => {
  cmdit(
    ['repository', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Manage registered repositories

          Usage
              $ socket repository <command>
          
            Commands
              create                      Create a repository in an organization
              del                         Delete a repository in an organization
              list                        List repositories in an organization
              update                      Update a repository in an organization
              view                        View repositories in an organization
          
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
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket repository\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket repository`',
      )
    },
  )

  cmdit(
    ['repository', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
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
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket repository\`, cwd: <redacted>
        [DryRun]: No-op, call a sub-command; ok"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    ['repo', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support repo alias with ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Manage registered repositories

          Usage
              $ socket repository <command>
          
            Commands
              create                      Create a repository in an organization
              del                         Delete a repository in an organization
              list                        List repositories in an organization
              update                      Update a repository in an organization
              view                        View repositories in an organization
          
            Options
          
              --no-banner                 Hide the Socket banner
              --no-spinner                Hide the console spinner
              --quiet                     Route non-essential output (status, progress, warnings) to stderr so stdout carries only the payload. Implied by --json and --markdown."
      `)
      expect(stderr).toContain('`socket repository`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )
})
