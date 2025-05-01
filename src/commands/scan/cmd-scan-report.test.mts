import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

const { CLI } = constants

describe('socket scan report', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['scan', 'report', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Check whether a scan result passes the organizational policies (security, license)

          Usage
            $ socket scan report <org slug> <scan ID> [path to output file]

          API Token Requirements
            - Quota: 2 units
            - Permissions: full-scans:list security-policy:read

          Options
            --fold            Fold reported alerts to some degree
            --help            Print this help
            --interactive     Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json            Output result as json
            --license         Also report the license policy status. Default: false
            --markdown        Output result as markdown
            --org             Force override the organization slug, overrides the default org from config
            --reportLevel     Which policy level alerts should be reported
            --short           Report only the healthy status

          By default the result is a nested object that looks like this:
            \`{[ecosystem]: {[pkgName]: {[version]: {[file]: {[type:loc]: policy}}}}\`
          You can fold this up to given level: 'pkg', 'version', 'file', and 'none'.

          By default only the warn and error policy level alerts are reported. You can
          override this and request more ('defer' < 'ignore' < 'monitor' < 'warn' < 'error')

          Short responses: JSON: \`{healthy:bool}\`, markdown: \`healthy = bool\`, text: \`OK/ERR\`

          Examples
            $ socket scan report FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0 --json --fold=version
            $ socket scan report FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0 --license --markdown --short"
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan report\`, cwd: <redacted>"
      `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan report`'
      )
    }
  )

  cmdit(
    ['scan', 'report', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan report\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again

          - Org name must be the first argument (\\x1b[31mmissing\\x1b[39m)

          - Scan ID to fetch (\\x1b[31mmissing\\x1b[39m)

          - You need to be logged in to use this command. See \`socket login\`. (\\x1b[31mmissing API token\\x1b[39m)
        \\x1b[22m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    [
      'scan',
      'report',
      'org',
      'report-id',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}'
    ],
    'should be ok with org name and id',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan report\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
