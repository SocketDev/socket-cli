import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket scan list', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(['scan', 'list', '--help'], 'should support --help', async cmd => {
    const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `
      "List the scans for an organization

        Usage
          $ socket scan list <org slug>

        Options
          --direction       Direction option (\`desc\` or \`asc\`) - Default is \`desc\`
          --dryRun          Do input validation for a command and exit 0 when input is ok
          --fromTime        From time - as a unix timestamp
          --help            Print this help.
          --json            Output result as json
          --markdown        Output result as markdown
          --page            Page number - Default is 1
          --perPage         Results per page - Default is 30
          --sort            Sorting option (\`name\` or \`created_at\`) - default is \`created_at\`
          --untilTime       Until time - as a unix timestamp

        Examples
          $ socket scan list FakeOrg"
    `
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan list\`, cwd: <redacted>"
    `)

    expect(code, 'help should exit with code 2').toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      '`socket scan list`'
    )
  })

  cmdit(
    ['scan', 'list', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan list\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

        - Org name as the argument \\x1b[31m(missing!)\\x1b[39m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    ['scan', 'list', 'fakeorg', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan list\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
