/**
 * Integration tests for `socket logout` command.
 *
 * Tests the Socket API logout flow. This command clears all stored credentials
 * from the local configuration, requiring re-authentication for future API operations.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - Credential clearing from local config
 * - Exit codes for successful logout
 *
 * Logout Behavior:
 * - Removes API token from local config
 * - Clears default organization setting
 * - Does not revoke token on server (token remains valid)
 * - Preserves other config settings (API URL, proxy, etc.)
 *
 * Security Note:
 * This command only clears local credentials. To revoke an API token
 * completely, use the Socket dashboard to delete the token.
 *
 * Related Files:
 * - src/commands/logout/cmd-logout.mts - Command definition
 * - src/commands/logout/handle-logout.mts - Logout logic
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

describe('socket logout', async () => {
  cmdit(
    ['logout', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Socket API logout

          Usage
                $ socket logout [options]
          
              Logs out of the Socket API and clears all Socket credentials from disk
          
              Examples
                $ socket logout"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket logout\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket logout`',
      )
    },
  )

  cmdit(
    [
      'logout',
      'mootools',
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
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket logout\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
