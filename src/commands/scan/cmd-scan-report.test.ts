import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket scan report', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(['scan', 'report', '--help'], 'should support --help', async cmd => {
    const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `
      "Check whether a scan result passes the organizational policies (security, license)

        Usage
          $ socket scan report <org slug> <scan ID> [path to output file]

        Options
          --dryRun          Do input validation for a command and exit 0 when input is ok
          --fold            Fold reported alerts to some degree
          --help            Print this help.
          --json            Output result as json
          --markdown        Output result as markdown
          --reportLevel     Which policy level alerts should be reported
          --security        Report the security policy status. Default: true

        This consumes 1 quota unit plus 1 for each of the requested policy types.

        Note: By default it reports both so by default it consumes 3 quota units.

        Your API token will need the \`full-scans:list\` scope regardless. Additionally
        it needs \`security-policy:read\` to report on the security policy.

        By default the result is a nested object that looks like this:
          \`{[ecosystem]: {[pkgName]: {[version]: {[file]: {[type:loc]: policy}}}}\`
        You can fold this up to given level: 'pkg', 'version', 'file', and 'none'.

        By default only the warn and error policy level alerts are reported. You can
        override this and request more ('defer' < 'ignore' < 'monitor' < 'warn' < 'error')

        Examples
          $ socket scan report FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0 --json --fold=version"
    `
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan report\`, cwd: <redacted>"
    `)

    expect(code, 'help should exit with code 2').toBe(2)
    expect(stderr, 'header should include command (without params)').toContain(
      '`socket scan report`'
    )
  })

  cmdit(
    ['scan', 'report', '--dry-run'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan report\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[37mInput error\\x1b[39m\\x1b[49m: Please provide the required fields:

        - Org name as the first argument \\x1b[31m(missing!)\\x1b[39m

        - Full Scan ID to fetch as second argument \\x1b[31m(missing!)\\x1b[39m

        - Not both the --json and --markdown flags \\x1b[32m(ok)\\x1b[39m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    ['scan', 'report', 'org', 'report-id', '--dry-run'],
    'should be ok with org name and id',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan report\`, cwd: <redacted>"
    `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
