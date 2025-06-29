import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket scan list', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['scan', 'list', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "List the scans for an organization

          Usage
            $ socket scan list [options] [REPO [BRANCH]]

          API Token Requirements
            - Quota: 1 unit
            - Permissions: full-scans:list

          Optionally filter by REPO. If you specify a repo, you can also specify a
          branch to filter by. (Note: If you don't specify a repo then you must use
          \`--branch\` to filter by branch across all repos).

          Options
            --branch          Filter to show only scans with this branch name
            --direction       Direction option (\`desc\` or \`asc\`) - Default is \`desc\`
            --fromTime        From time - as a unix timestamp
            --interactive     Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json            Output result as json
            --markdown        Output result as markdown
            --org             Force override the organization slug, overrides the default org from config
            --page            Page number - Default is 1
            --perPage         Results per page - Default is 30
            --sort            Sorting option (\`name\` or \`created_at\`) - default is \`created_at\`
            --untilTime       Until time - as a unix timestamp

          Examples
            $ socket scan list
            $ socket scan list webtools badbranch --markdown"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan list\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan list`',
      )
    },
  )

  cmdit(
    ['scan', 'list', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan list\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: you can run \`socket login\` to set a default org. You can also override it with the --org flag.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          - Org name by default setting, --org, or auto-discovered (dot is an invalid org, most likely you forgot the org name here?)

          - You need to be logged in to use this command. See \`socket login\`. (missing API token)
        "
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'scan',
      'list',
      '--org',
      'fakeorg',
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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, --org: fakeorg
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan list\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
