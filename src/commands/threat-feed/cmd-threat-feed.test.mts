import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket threat-feed', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['threat-feed', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "[Beta] View the threat feed

          Usage
            $ socket threat-feed [options] [ECOSYSTEM] [TYPE_FILTER]

          API Token Requirements
            - Quota: 1 unit
            - Permissions: threat-feed:list
            - Special access

          This feature requires a Threat Feed license. Please contact
          sales@socket.dev if you are interested in purchasing this access.

          Options
            --direction         Order asc or desc by the createdAt attribute
            --eco               Only show threats for a particular ecosystem
            --filter            Filter what type of threats to return
            --interactive       Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json              Output result as json
            --markdown          Output result as markdown
            --org               Force override the organization slug, overrides the default org from config
            --page              Page token
            --per-page          Number of items per page
            --pkg               Filter by this package name
            --version           Filter by this package version

          Valid ecosystems:

            - gem
            - golang
            - maven
            - npm
            - nuget
            - pypi

          Valid type filters:

            - anom    Anomaly
            - c       Do not filter
            - fp      False Positives
            - joke    Joke / Fake
            - mal     Malware and Possible Malware [default]
            - secret  Secrets
            - spy     Telemetry
            - tp      False Positives and Unreviewed
            - typo    Typo-squat
            - u       Unreviewed
            - vuln    Vulnerability

          Note: if you filter by package name or version, it will do so for anything
                unless you also filter by that ecosystem and/or package name. When in
                doubt, look at the threat-feed and see the names in the name/version
                column. That's what you want to search for.

          You can put filters as args instead, we'll try to match the strings with the
          correct filter type but since this would not allow you to search for a package
          called "mal", you can also specify the filters through flags.

          First arg that matches a typo, eco, or version enum is used as such. First arg
          that matches none of them becomes the package name filter. Rest is ignored.

          Note: The version filter is a prefix search, pkg name is a substring search.

          Examples
            $ socket threat-feed
            $ socket threat-feed maven --json
            $ socket threat-feed typo
            $ socket threat-feed npm joke 1.0.0 --perPage=5 --page=2 --direction=asc"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket threat-feed`',
      )
    },
  )

  cmdit(
    ['threat-feed', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: you can run \`socket login\` to set a default org. You can also override it with the --org flag.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          - Org name by default setting, --org, or auto-discovered (missing)

          - You need to be logged in to use this command. See \`socket login\`. (missing Socket API token)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'threat-feed',
      '--org',
      'boo',
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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, --org: boo
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    ['threat-feed', '--dry-run', '--config', '{"apiToken":"anything"}'],
    'should report missing org name',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: you can run \`socket login\` to set a default org. You can also override it with the --org flag.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          - Org name by default setting, --org, or auto-discovered (missing)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'threat-feed',
      '--dry-run',
      '--config',
      '{"apiToken":"anything", "defaultOrg": "fakeorg"}',
    ],
    'should accept default org',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'threat-feed',
      '--org',
      'forcedorg',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}',
    ],
    'should accept --org flag',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, --org: forcedorg
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
