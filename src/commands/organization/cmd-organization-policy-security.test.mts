import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, spawnNpm } from '../../../test/utils.mts'

describe('socket organization policy security', async () => {
  const { binCliPath } = constants

  cmdit(
    ['organization', 'policy', 'security', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Retrieve the security policy of an organization

          Usage
            $ socket organization policy security [options]

          API Token Requirements
            - Quota: 1 unit
            - Permissions: security-policy:read

          Options
            --interactive       Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json              Output result as json
            --markdown          Output result as markdown
            --org               Force override the organization slug, overrides the default org from config

          Your API token will need the \`security-policy:read\` permission otherwise
          the request will fail with an authentication error.

          Examples
            $ socket organization policy security
            $ socket organization policy security --json"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>"
      `)

      //expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket organization policy security`',
      )
    },
  )

  cmdit(
    ['organization', 'policy', 'security', '--dry-run', '--config', '{}'],
    'should reject dry run without proper args',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
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

      expect(code, 'dry-run should exit with code 2 if input bad').toBe(2)
    },
  )

  cmdit(
    [
      'organization',
      'policy',
      'security',
      '--dry-run',
      '--config',
      '{"isTestingV1": true, "apiToken":"fakeToken", "defaultOrg": "fakeOrg"}',
    ],
    'should accept default org in v1',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'organization',
      'policy',
      'security',
      '--org',
      'forcedorg',
      '--dry-run',
      '--config',
      '{"isTestingV1": true, "apiToken":"fakeToken"}',
    ],
    'should accept --org flag in v1',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, --org: forcedorg
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
