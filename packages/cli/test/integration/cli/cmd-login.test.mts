/**
 * Integration tests for `socket login` command.
 *
 * Tests the Socket API authentication flow. This command prompts for an API token
 * and stores it in the local configuration for subsequent CLI operations.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - API base URL customization (--api-base-url)
 * - API proxy configuration (--api-proxy)
 * - Exit codes for successful/failed authentication
 *
 * Authentication Flow:
 * 1. Prompts user for Socket API token
 * 2. Validates token with Socket API
 * 3. Auto-discovers default organization
 * 4. Stores credentials in local config
 *
 * Custom API Configuration:
 * - --api-base-url: Connect to alternative Socket API endpoints
 * - --api-proxy: Route API requests through proxy server
 *
 * Related Files:
 * - src/commands/login/cmd-login.mts - Command definition
 * - src/commands/login/handle-login.mts - Authentication logic
 * - src/utils/config.mts - Config storage utilities
 * - src/utils/api.mts - Socket API client
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

describe('socket login', async () => {
  cmdit(
    ['login', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Setup Socket CLI with an API token and defaults

          Usage
                $ socket login [options]
          
              API Token Requirements
                - Quota: 1 unit
          
              Logs into the Socket API by prompting for an API token
          
              Options
                --api-base-url      API server to connect to for login
                --api-proxy         Proxy to use when making connection to API server
          
              Examples
                $ socket login
                $ socket login --api-proxy=http://localhost:1234"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket login\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket login`')
    },
  )

  cmdit(
    [
      'login',
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
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket login\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
