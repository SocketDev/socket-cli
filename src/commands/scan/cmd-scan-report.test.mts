import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket scan report', async () => {
  const { binCliPath } = constants

  cmdit(
    ['scan', 'report', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Check whether a scan result passes the organizational policies (security, license)

          Usage
            $ socket scan report [options] <SCAN_ID> [OUTPUT_PATH]

          API Token Requirements
            - Quota: 2 units
            - Permissions: full-scans:list security-policy:read

          Options
            --fold              Fold reported alerts to some degree
            --interactive       Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json              Output result as json
            --license           Also report the license policy status. Default: false
            --markdown          Output result as markdown
            --org               Force override the organization slug, overrides the default org from config
            --report-level      Which policy level alerts should be reported
            --short             Report only the healthy status

          When no output path is given the contents is sent to stdout.

          By default the result is a nested object that looks like this:
            \`{
              [ecosystem]: {
                [pkgName]: {
                  [version]: {
                    [file]: {
                      [line:col]: alert
            }}}}\`
          So one alert for each occurrence in every file, version, etc, a huge response.

          You can --fold these up to given level: 'pkg', 'version', 'file', and 'none'.
          For example: \`socket scan report --fold=version\` will dedupe alerts to only
          show one alert of a particular kind, no matter how often it was foud in a
          file or in how many files it was found. At most one per version that has it.

          By default only the warn and error policy level alerts are reported. You can
          override this and request more ('defer' < 'ignore' < 'monitor' < 'warn' < 'error')

          Short responses look like this:
            --json:     \`{healthy:bool}\`
            --markdown: \`healthy = bool\`
            neither:    \`OK/ERR\`

          Examples
            $ socket scan report 000aaaa1-0000-0a0a-00a0-00a0000000a0 --json --fold=version
            $ socket scan report 000aaaa1-0000-0a0a-00a0-00a0000000a0 --license --markdown --short"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan report\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan report`',
      )
    },
  )

  cmdit(
    ['scan', 'report', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan report\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: Run \`socket login\` to set a default org.
              Use the --org flag to override the default org.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 Org name by default setting, --org, or auto-discovered (dot is an invalid org, most likely you forgot the org name here?)
          \\xd7 Scan ID to report on (missing)
          \\xd7 This command requires a Socket API token for access (try \`socket login\`)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'scan',
      'report',
      'org',
      'report-id',
      '--dry-run',
      '--org',
      'fakeOrg',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should be ok with org name and id',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, --org: fakeOrg
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan report\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
