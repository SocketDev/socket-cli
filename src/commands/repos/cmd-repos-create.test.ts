import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket repos create', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['repos', 'create', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
      "Create a repository in an organization

        Usage
          $ socket repos create <org slug>

        Options
          --defaultBranch   Repository default branch
          --dryRun          Do input validation for a command and exit 0 when input is ok
          --help            Print this help.
          --homepage        Repository url
          --repoDescription Repository description
          --repoName        Repository name
          --visibility      Repository visibility (Default Private)

        Examples
          $ socket repos create FakeOrg --repoName=test-repo"
    `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>"
    `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket repos create`'
      )
    }
  )

  cmdit(
    ['repos', 'create', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

        - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

        - Repository name using --repoName \\x1b[31m(missing!)\\x1b[39m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    ['repos', 'create', 'a', '--repoName', 'b', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
