import path from 'node:path'

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
        "[beta] View the threat feed

          Usage
            $ socket threat-feed <org slug>

          API Token Requirements
            - Quota: 1 unit
            - Permissions: threat-feed:list
            - Special access

          This feature requires a Threat Feed license. Please contact
          sales@socket.dev if you are interested in purchasing this access.

          Options
            --direction       Order asc or desc by the createdAt attribute
            --eco             Only show threats for a particular ecosystem
            --filter          Filter what type of threats to return
            --interactive     Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json            Output result as json
            --markdown        Output result as markdown
            --org             Force override the organization slug, overrides the default org from config
            --page            Page token
            --perPage         Number of items per page
            --pkg             Filter by this package name
            --version         Filter by this package version

          Valid filters:

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

          Valid ecosystems:

            - gem
            - golang
            - maven
            - npm
            - nuget
            - pypi

          Note: if you filter by package name or version, it will do so for anything
                unless you also filter by that ecosystem and/or package name. When in
                doubt, look at the threat-feed and see the names in the name/version
                column. That's what you want to search for.

          Examples
            $ socket threat-feed FakeOrg
            $ socket threat-feed FakeOrg --perPage=5 --page=2 --direction=asc --filter=joke"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again

          - Org name as the first argument (\\x1b[31mmissing\\x1b[39m)

          - You need to be logged in to use this command. See \`socket login\`. (\\x1b[31mmissing API token\\x1b[39m)
        \\x1b[22m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    ['threat-feed', 'boo', '--dry-run', '--config', '{"apiToken":"anything"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'threat-feed',
      '--dry-run',
      '--config',
      '{"isTestingV1": true, "apiToken":"anything"}',
    ],
    'should report missing org name in v1',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted> (is testing v1)
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>
        \\x1b[32m   (Thank you for testing the v1 bump! Please send us any feedback you might have!)
        \\x1b[39m
        \\x1b[33m\\u203c\\x1b[39m Missing the org slug and no --org flag set. Trying to auto-discover the org now...
        \\x1b[34mi\\x1b[39m Note: you can set the default org slug to prevent this issue. You can also override all that with the --org flag.
        \\x1b[31m\\xd7\\x1b[39m Skipping auto-discovery of org in dry-run mode
        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again

          - Org name as the first argument (\\x1b[31mmissing\\x1b[39m)
        \\x1b[22m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'threat-feed',
      '--dry-run',
      '--config',
      '{"isTestingV1": true, "apiToken":"anything", "defaultOrg": "fakeorg"}',
    ],
    'should accept default org in v1',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted> (is testing v1)
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>, default org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>
        \\x1b[32m   (Thank you for testing the v1 bump! Please send us any feedback you might have!)
        \\x1b[39m"
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
      '{"isTestingV1": true, "apiToken":"anything"}',
    ],
    'should accept --org flag in v1',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted> (is testing v1)
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>
        \\x1b[32m   (Thank you for testing the v1 bump! Please send us any feedback you might have!)
        \\x1b[39m"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
