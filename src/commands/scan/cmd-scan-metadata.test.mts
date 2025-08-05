import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket scan metadata', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['scan', 'metadata', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Get a scan's metadata

          Usage
            $ socket scan metadata [options] <SCAN_ID>

          API Token Requirements
            - Quota: 1 unit
            - Permissions: full-scans:list

          Options
            --interactive     Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json            Output result as json
            --markdown        Output result as markdown
            --org             Force override the organization slug, overrides the default org from config

          Examples
            $ socket scan metadata 000aaaa1-0000-0a0a-00a0-00a0000000a0
            $ socket scan metadata 000aaaa1-0000-0a0a-00a0-00a0000000a0 --json"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan metadata\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan metadata`',
      )
    },
  )

  cmdit(
    ['scan', 'metadata', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan metadata\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: you can run \`socket login\` to set a default org. You can also override it with the --org flag.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          - Org name by default setting, --org, or auto-discovered (missing)

          - Scan ID to inspect as argument (missing)

          - You need to be logged in to use this command. See \`socket login\`. (missing Socket API token)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'scan',
      'metadata',
      '--org',
      'fakeorg',
      'scanidee',
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
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan metadata\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
