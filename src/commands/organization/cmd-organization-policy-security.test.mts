import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket organization policy security', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['organization', 'policy', 'security', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Retrieve the security policy of an organization

          Usage
            $ socket organization policy security [options]

          API Token Requirements
            - Quota: 1 unit
            - Permissions: security-policy:read

          Options
            --interactive     Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json            Output result as json
            --markdown        Output result as markdown
            --org             Force override the organization slug, overrides the default org from config

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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket organization policy security`',
      )
    },
  )

  cmdit(
    ['organization', 'policy', 'security', '--dry-run', '--config', '{}'],
    'should reject dry run without proper args',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>
        \\x1b[33m\\u203c\\x1b[39m Missing the org slug and no --org flag set. Trying to auto-discover the org now...
        \\x1b[34mi\\x1b[39m Note: you can set the default org slug to prevent this issue. You can also override all that with the --org flag.
        \\x1b[31m\\xd7\\x1b[39m Skipping auto-discovery of org in dry-run mode
        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again

          - Org name as the first argument (\\x1b[31mmissing\\x1b[39m)

          - You need to be logged in to use this command. See \`socket login\`. (\\x1b[31mmissing API token\\x1b[39m)
        \\x1b[22m"
      `)

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
      '{"isTestingV1": true, "apiToken":"anything"}',
    ],
    'should report missing org name in v1',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>
        \\x1b[33m\\u203c\\x1b[39m Missing the org slug and no --org flag set. Trying to auto-discover the org now...
        \\x1b[34mi\\x1b[39m Note: you can set the default org slug to prevent this issue. You can also override all that with the --org flag.
        \\x1b[31m\\xd7\\x1b[39m Skipping auto-discovery of org in dry-run mode
        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again

          - Org name as the first argument (\\x1b[31mmissing\\x1b[39m)
        \\x1b[22m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'organization',
      'policy',
      'security',
      '--dry-run',
      '--config',
      '{"isTestingV1": true, "apiToken":"anything", "defaultOrg": "fakeorg"}',
    ],
    'should accept default org in v1',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>, org: <redacted>
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
      '{"isTestingV1": true, "apiToken":"anything"}',
    ],
    'should accept --org flag in v1',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
