import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket package score', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['package', 'score', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Look up score for one package which reflects all of its transitive dependencies as well

          Usage
            $ socket package score [options] <<ECOSYSTEM> <NAME> | <PURL>>

          API Token Requirements
            - Quota: 100 units
            - Permissions: packages:list

          Options
            --json            Output result as json
            --markdown        Output result as markdown

          Show deep scoring details for one package. The score will reflect the package
          itself, any of its dependencies, and any of its transitive dependencies.

          When you want to know whether to trust a package, this is the command to run.

          See also the \`socket package shallow\` command, which returns the shallow
          score for any number of packages. That will not reflect the dependency scores.

          Only a few ecosystems are supported like npm, pypi, nuget, gem, golang, and maven.

          A "purl" is a standard package name formatting: \`pkg:eco/name@version\`
          This command will automatically prepend "pkg:" when not present.

          The version is optional but when given should be a direct match. The \`pkg:\`
          prefix is optional.

          Note: if a package cannot be found it may be too old or perhaps was removed
                before we had the opportunity to process it.

          Examples
            $ socket package score npm babel-cli
            $ socket package score npm eslint@1.0.0 --json
            $ socket package score pkg:golang/github.com/steelpoor/tlsproxy@v0.0.0-20250304082521-29051ed19c60
            $ socket package score nuget/needpluscommonlibrary@1.0.0 --markdown"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package score\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(
        stderr,
        'header should include command (without params)',
      ).toContain('`socket package score`')
    },
  )

  cmdit(
    ['package', 'score', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package score\`, cwd: <redacted>

        \\xd7  Input error:  Please review the input requirements and try again

          - First parameter must be an ecosystem or the whole purl (bad)

          - Expecting at least one package (missing)

          - You need to be logged in to use this command. See \`socket login\`. (missing Socket API token)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'package',
      'score',
      'npm',
      'babel',
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
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket package score\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
