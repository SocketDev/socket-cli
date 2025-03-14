import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket analytics', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(['analytics', '--help'], 'should support --help', async cmd => {
    const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `
      "Look up analytics data

        Usage
          $ socket analytics --scope=<scope> --time=<time filter>

        Default parameters are set to show the organization-level analytics over the
        last 7 days.

        Options
          --dryRun          Do input validation for a command and exit 0 when input is ok
          --file            Path to a local file to save the output. Only valid with --json/--markdown. Defaults to stdout.
          --help            Print this help.
          --json            Output result as json
          --markdown        Output result as markdown
          --repo            Name of the repository. Only valid when scope=repo
          --scope           Scope of the analytics data - either 'org' or 'repo', default: org
          --time            Time filter - either 7, 30 or 90, default: 7

        Examples
          $ socket analytics --scope=org --time=7
          $ socket analytics --scope=org --time=30
          $ socket analytics --scope=repo --repo=test-repo --time=30"
    `
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket analytics\`, cwd: <redacted>"
    `)

    expect(code, 'help should exit with code 2').toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      '`socket analytics`'
    )
  })

  cmdit(
    ['analytics', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket analytics\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
