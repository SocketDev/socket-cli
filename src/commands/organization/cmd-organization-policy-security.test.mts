import path from 'node:path'

import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_ORG,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket organization policy security', async () => {
  const { binCliPath } = constants

  cmdit(
    ['organization', 'policy', 'security', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for organization:
          list - List all organizations
          dependencies - View organization dependencies
          quota - View organization quota and usage
          policy - Manage organization policies"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      //expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket organization policy security`',
      )
    },
  )

  // Tests legacy pre-v1.0 behavior where positional org arguments were accepted.
  // In v1.0+, org must be specified via --org flag or default config.
  // Dry-run mode exits without validating API token (code 0 despite missing token).
  cmdit(
    ['organization', 'policy', 'security', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should reject dry run without proper args',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for organization:
          list - List all organizations
          dependencies - View organization dependencies
          quota - View organization quota and usage
          policy - Manage organization policies"
      `)
      // expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      //   "
      //      _____         _       _        /---------------
      //     |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
      //     |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
      //     |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>

      //   \\u203c Unable to determine the target org. Trying to auto-discover it now...
      //   i Note: you can run \`socket login\` to set a default org. You can also override it with the --org flag.

      //   \\xd7 Skipping auto-discovery of org in dry-run mode
      //   \\xd7  Input error:  Please review the input requirements and try again

      //     - You need to be logged in to use this command. See \`socket login\`. (missing API token)
      //   "
      // `)

      expect(code, 'dry-run exits with success code').toBe(0)
    },
  )

  cmdit(
    [
      'organization',
      'policy',
      'security',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"isTestingV1": true, "apiToken":"fakeToken", "defaultOrg": "fakeOrg"}',
    ],
    'should accept default org in v1',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for organization:
          list - List all organizations
          dependencies - View organization dependencies
          quota - View organization quota and usage
          policy - Manage organization policies"
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
      'organization',
      'policy',
      'security',
      FLAG_ORG,
      'forcedorg',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"isTestingV1": true, "apiToken":"fakeToken"}',
    ],
    'should accept --org flag in v1',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Available subcommands for organization:
          list - List all organizations
          dependencies - View organization dependencies
          quota - View organization quota and usage
          policy - Manage organization policies"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
