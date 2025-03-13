import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket organization list', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['organization', 'policy', 'security', '--help'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
      "Retrieve the security policy of an organization.

        Usage
          $ socket organization policy security <org slug>

        Options
          --dryRun          Do input validation for a command and exit 0 when input is ok
          --help            Print this help.
          --json            Output result as json
          --markdown        Output result as markdown

        Your API token will need the \`security-policy:read\` permission otherwise
        the request will fail with an authentication error.

        Examples
          $ socket organization policy security mycorp
          $ socket organization policy security mycorp --json"
    `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>"
    `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(
        stderr,
        'header should include command (without params)'
      ).toContain('`socket organization policy security`')
    }
  )

  cmdit(
    ['organization', 'policy', 'security', '--dry-run'],
    'should reject dry run without proper args',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>

      \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

      - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m
      - The json and markdown flags cannot be both set \\x1b[32m(ok)\\x1b[39m"
    `)

      expect(code, 'dry-run should exit with code 2 if input bad').toBe(2)
    }
  )

  cmdit(
    ['organization', 'policy', 'security', 'fakeorg', '--dry-run'],
    'should be ok with org name and id',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>"
    `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
