import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket scan diff', async () => {
  const { binCliPath } = constants

  cmdit(
    ['scan', 'diff', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "See what changed between two Scans

          Usage
            $ socket scan diff [options] <SCAN_ID1> <SCAN_ID2>

          API Token Requirements
            - Quota: 1 unit
            - Permissions: full-scans:list

          This command displays the package changes between two scans. The full output
          can be pretty large depending on the size of your repo and time range. It is
          best stored to disk (with --json) to be further analyzed by other tools.

          Note: While it will work in any order, the first Scan ID is assumed to be the
                older ID, even if it is a newer Scan. This is only relevant for the
                added/removed list (similar to diffing two files with git).

          Options
            --depth             Max depth of JSON to display before truncating, use zero for no limit (without --json/--file)
            --file              Path to a local file where the output should be saved. Use \`-\` to force stdout.
            --interactive       Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json              Output result as json
            --markdown          Output result as markdown
            --org               Force override the organization slug, overrides the default org from config

          Examples
            $ socket scan diff aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 aaa1aa1a-aaaa-1111-1a1a-1111111a11a1
            $ socket scan diff aaa0aa0a-aaaa-0000-0a0a-0000000a00a0 aaa1aa1a-aaaa-1111-1a1a-1111111a11a1 --json"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan diff\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan diff`',
      )
    },
  )

  cmdit(
    ['scan', 'diff', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan diff\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: Run \`socket login\` to set a default org.
              Use the --org flag to override the default org.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 Specify two Scan IDs. (missing both Scan IDs)
            A Scan ID looks like \`aaa0aa0a-aaaa-0000-0a0a-0000000a00a0\`.
          \\xd7 Org name by default setting, --org, or auto-discovered (missing)
          \\xd7 This command requires a Socket API token for access (try \`socket login\`)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'scan',
      'diff',
      '--org',
      'fakeOrg',
      '--dry-run',
      '--config',
      '{"apiToken":"fakeToken"}',
      'x',
      'y',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, --org: fakeOrg
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan diff\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
