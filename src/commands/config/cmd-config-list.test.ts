import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket config get', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['config', 'list', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Show all local CLI config items and their values

          Usage
            $ socket config list <org slug>

          Options
            --full            Show full tokens in plaintext (unsafe)
            --help            Print this help
            --json            Output result as json
            --markdown        Output result as markdown

          Keys:

           - apiBaseUrl -- Base URL of the API endpoint
           - apiProxy -- A proxy through which to access the API
           - apiToken -- The API token required to access most API endpoints
           - defaultOrg -- The default org slug to use; usually the org your API token has access to. When set, all orgSlug arguments are implied to be this value.
           - enforcedOrgs -- Orgs in this list have their security policies enforced on this machine

          Examples
            $ socket config list FakeOrg --repoName=test-repo"
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config list\`, cwd: <redacted>"
      `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket config list`'
      )
    }
  )

  cmdit(
    ['config', 'list', '--dry-run', '--config', '{"apiToken":"anything"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config list\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
