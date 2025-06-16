import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket config get', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['config', 'set', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Update the value of a local CLI config item

          Usage
            $ socket config set [options] <KEY> <VALUE>

          Options
            --json            Output result as json
            --markdown        Output result as markdown

          This is a crude way of updating the local configuration for this CLI tool.

          Note that updating a value here is nothing more than updating a key/value
          store entry. No validation is happening. The server may reject your values
          in some cases. Use at your own risk.

          Note: use \`socket config unset\` to restore to defaults. Setting a key
          to \`undefined\` will not allow default values to be set on it.

          Keys:

           - apiBaseUrl -- Base URL of the API endpoint
           - apiProxy -- A proxy through which to access the API
           - apiToken -- The API token required to access most API endpoints
           - defaultOrg -- The default org slug to use; usually the org your API token has access to. When set, all orgSlug arguments are implied to be this value.
           - enforcedOrgs -- Orgs in this list have their security policies enforced on this machine
           - skipAskToPersistDefaultOrg -- This flag prevents the CLI from asking you to persist the org slug when you selected one interactively
           - org -- Alias for defaultOrg

          Examples
            $ socket config set apiProxy https://example.com"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config set\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket config set`',
      )
    },
  )

  cmdit(
    ['config', 'set', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config set\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again

          - Config key should be the first arg (\\x1b[31mmissing\\x1b[39m)

          - Key value should be the remaining args (use \`unset\` to unset a value) (\\x1b[31mmissing\\x1b[39m)
        \\x1b[22m"
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
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config set\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
