import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket threat-feed', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(['threat-feed', '--help'], 'should support --help', async cmd => {
    const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `
      "[beta] View the threat feed

        Usage
          $ socket threat-feed

        This feature requires a Threat Feed license. Please contact
        sales@socket.dev if you are interested in purchasing this access.

        Options
          --direction       Order asc or desc by the createdAt attribute.
          --dryRun          Do input validation for a command and exit 0 when input is ok
          --eco             Only show threats for a particular ecosystem
          --filter          Filter what type of threats to return
          --help            Print this help.
          --json            Output result as json
          --markdown        Output result as markdown
          --page            Page token
          --perPage         Number of items per page

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

        Examples
          $ socket threat-feed
          $ socket threat-feed --perPage=5 --page=2 --direction=asc --filter=joke"
    `
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>"
    `)

    expect(code, 'help should exit with code 2').toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      '`socket threat-feed`'
    )
  })

  cmdit(
    ['threat-feed', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket threat-feed\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
