import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket scan diff', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['scan', 'diff', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "See what changed between two Scans

          Usage
            $ socket scan diff <org slug> <ID1> <ID2>

          API Token Requirements
            - Quota: 1 unit
            - Permissions: full-scans:list

          This command displays the package changes between two scans. The full output
          can be pretty large depending on the size of your repo and time range. It is
          best stored to disk (with --json) to be further analyzed by other tools.

          Note: First Scan ID is assumed to be the older ID. This is only relevant for
                the added/removed list (similar to diffing two files with git).

          Options
            --depth           Max depth of JSON to display before truncating, use zero for no limit (without --json/--file)
            --dryRun          Do input validation for a command and exit 0 when input is ok
            --file            Path to a local file where the output should be saved. Use \`-\` to force stdout.
            --help            Print this help
            --json            Output result as json
            --markdown        Output result as markdown

          Examples
            $ socket scan diff FakeCorp aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 aaa1aa1a-aaaa-1111-1a1a-1111111a11a1
            $ socket scan diff FakeCorp aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 aaa1aa1a-aaaa-1111-1a1a-1111111a11a1 --json"
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan diff\`, cwd: <redacted>"
      `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan diff`'
      )
    }
  )

  cmdit(
    ['scan', 'diff', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan diff\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again\\x1b[22m

          - Specify two Scan IDs. (\\x1b[31mmissing both Scan IDs\\x1b[39m)
            A Scan ID looks like \`aaa0aa0a-aaaa-0000-0a0a-0000000a00a0\`.

          - Org name as the first argument (\\x1b[31mmissing\\x1b[39m)

          - You need to be logged in to use this command. See \`socket login\`. (\\x1b[31mmissing API token\\x1b[39m)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    [
      'scan',
      'diff',
      'fakeorg',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}',
      'x',
      'y'
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan diff\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
