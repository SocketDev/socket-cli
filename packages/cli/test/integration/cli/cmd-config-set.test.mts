/**
 * Integration tests for `socket config set` command.
 *
 * Tests updating local CLI configuration values. This command provides a
 * simple key-value store interface for modifying config settings.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Key and value argument validation
 * - Dry-run behavior validation
 * - Error handling (missing arguments)
 *
 * Important Notes:
 * - No validation is performed on values (validation happens at API time)
 * - Use `socket config unset` to restore defaults
 * - Setting a key to "undefined" does NOT restore defaults
 *
 * Available Config Keys:
 * - apiBaseUrl: Socket API base URL
 * - apiProxy: Proxy for API requests
 * - apiToken: Authentication token
 * - defaultOrg: Default organization slug
 * - enforcedOrgs: Organizations with enforced policies
 * - skipAskToPersistDefaultOrg: Skip org persistence prompt
 *
 * Related Files:
 * - src/commands/config/cmd-config-set.mts - Command definition
 * - src/commands/config/handle-config-set.mts - Config update logic
 * - src/utils/config.mts - Config management utilities
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

describe('socket config get', async () => {
  cmdit(
    ['config', 'set', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Update the value of a local CLI config item

          Usage
                $ socket config set [options] <KEY> <VALUE>
          
              Options
                --json              Output as JSON
                --markdown          Output as Markdown
          
              This is a crude way of updating the local configuration for this CLI tool.
          
              Note that updating a value here is nothing more than updating a key/value
              store entry. No validation is happening. The server may reject your values
              in some cases. Use at your own risk.
          
              Note: use \`socket config unset\` to restore to defaults. Setting a key
              to \`undefined\` will not allow default values to be set on it.
          
              Keys:
          
               - apiBaseUrl -- Base URL of the Socket API endpoint
               - apiProxy -- A proxy through which to access the Socket API
               - apiToken -- The Socket API token required to access most Socket API endpoints
               - defaultOrg -- The default org slug to use; usually the org your Socket API token has access to. When set, all orgSlug arguments are implied to be this value.
               - enforcedOrgs -- Orgs in this list have their security policies enforced on this machine
               - org -- Alias for defaultOrg
               - skipAskToPersistDefaultOrg -- This flag prevents the Socket CLI from asking you to persist the org slug when you selected one interactively
          
              Examples
                $ socket config set apiProxy https://example.com"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket config set\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket config set`',
      )
    },
  )

  cmdit(
    ['config', 'set', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket config set\`, cwd: <redacted>

        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 Config key should be the first arg (missing)
          \\xd7 Key value should be the remaining args (use \`unset\` to unset a value) (missing)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'config',
      'set',
      'test',
      'xyz',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stdout)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket config set\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
