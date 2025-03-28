import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket package score', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(['package', 'score', '--help'], 'should support --help', async cmd => {
    const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `
        "Look up score for one package which reflects all of its transitive dependencies as well

          Usage
            $ socket package score <<ecosystem> <name> | <purl>>

          Options
            --dryRun          Do input validation for a command and exit 0 when input is ok
            --help            Print this help.
            --json            Output result as json
            --markdown        Output result as markdown

          Requirements
            - quota: 100
            - scope: \`packages:list\`

          Show deep scoring details for one package. The score will reflect the package
          itself, any of its dependencies, and any of its transitive dependencies.

          When you want to know whether to trust a package, this is the command to run.

          See also the \`socket package shallow\` command, which returns the shallow
          score for any number of packages. That will not reflect the dependency scores.

          Only a few ecosystems are supported like npm, golang, and maven.

          A "purl" is a standard package name formatting: \`pkg:eco/name@version\`
          This command will automatically prepend "pkg:" when not present.

          The version is optional but when given should be a direct match.

          Examples
            $ socket package score npm babel-cli
            $ socket package score npm babel-cli@1.9.1
            $ socket package score npm/babel-cli@1.9.1
            $ socket package score pkg:npm/babel-cli@1.9.1"
      `
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package score\`, cwd: <redacted>"
      `)

    expect(code, 'help should exit with code 2').toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      '`socket package score`'
    )
  })

  cmdit(
    ['package', 'score', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package score\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

              - First parameter should be an ecosystem or the arg must be a purl \\x1b[31m(bad!)\\x1b[39m

              - Expecting the package to check \\x1b[31m(missing!)\\x1b[39m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    ['package', 'score', 'npm', 'babel', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package score\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
