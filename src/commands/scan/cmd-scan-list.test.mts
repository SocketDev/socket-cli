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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan list\`, cwd: <redacted>

        \\x1b[33m\\u203c\\x1b[39m Missing the org slug and no --org flag set. Trying to auto-discover the org now...
        \\x1b[34mi\\x1b[39m Note: you can set the default org slug to prevent this issue. You can also override all that with the --org flag.
        \\x1b[31m\\xd7\\x1b[39m Skipping auto-discovery of org in dry-run mode
        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again

          - Org name by default setting, --org, or auto-discovered (\\x1b[31mdot is an invalid org, most likely you forgot the org name here?\\x1b[39m)

          - You need to be logged in to use this command. See \`socket login\`. (\\x1b[31mmissing API token\\x1b[39m)
        \\x1b[22m"
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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan list\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
