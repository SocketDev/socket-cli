import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket diff-scan get', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(['diff-scan', 'get', '--help'], 'should support --help', async cmd => {
    const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `
      "Get a diff scan for an organization

        Usage
          $ socket diff-scan get <org slug> --before=<before> --after=<after>

        This command displays the package changes between two scans. The full output
        can be pretty large depending on the size of your repo and time range. It is
        best stored to disk to be further analyzed by other tools.

        Options
          --after           The full scan ID of the head scan
          --before          The full scan ID of the base scan
          --depth           Max depth of JSON to display before truncating, use zero for no limit (without --json/--file)
          --dryRun          Do input validation for a command and exit 0 when input is ok
          --file            Path to a local file where the output should be saved. Use \`-\` to force stdout.
          --help            Print this help.
          --json            Output result as json. This can be big. Use --file to store it to disk without truncation.

        Examples
          $ socket diff-scan get FakeCorp --before=aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 --after=aaa1aa1a-aaaa-1111-1a1a-1111111a11a1"
    `
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket diff-scan get\`, cwd: <redacted>"
    `)

    expect(code, 'help should exit with code 2').toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      '`socket diff-scan get`'
    )
  })

  cmdit(
    ['diff-scan', 'get', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket diff-scan get\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

              - Specify a before and after full scan ID \\x1b[31m(missing before and after!)\\x1b[39m

                  - To get full scans IDs, you can run the command "socket scan list <your org slug>".
                    The args are expecting a full \`aaa0aa0a-aaaa-0000-0a0a-0000000a00a0\` ID.

              - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    [
      'diff-scan',
      'get',
      'fakeorg',
      '--dry-run',
      '--before',
      'x',
      '--after',
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
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket diff-scan get\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
