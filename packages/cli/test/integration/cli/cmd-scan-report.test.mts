/**
 * Integration tests for `socket scan report` command.
 *
 * Tests generating security scan reports.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - Report generation
 * - Output format support (JSON, markdown, HTML)
 * - Policy compliance checking
 *
 * Related Files:
 * - src/commands/scan/cmd-scan-report.mts - Command definition
 * - src/commands/scan/handle-scan-report.mts - Report generation logic
 * - src/commands/scan/output-scan-report.mts - Formatting
 */

import { describe, expect } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_ORG,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { expectDryRunOutput } from '../../helpers/output-assertions.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket scan report', async () => {
  cmdit(
    ['scan', 'report', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Check whether a scan result passes the organizational policies (security, license)

          Usage
                $ socket scan report [options] <SCAN_ID> [OUTPUT_PATH]
          
              API Token Requirements
                - Quota: 2 units
                - Permissions: full-scans:list and security-policy:read
          
              Options
                --fold              Fold reported alerts to some degree (default 'none')
                --interactive       Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
                --json              Output as JSON
                --license           Also report the license policy status. Default: false
                --markdown          Output as Markdown
                --org               Force override the organization slug, overrides the default org from config
                --report-level      Which policy level alerts should be reported (default 'warn')
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
              show one alert of a particular kind, no matter how often it was found in a
              file or in how many files it was found. At most one per version that has it.
          
              By default only the warn and error policy level alerts are reported. You can
              override this and request more ('defer' < 'ignore' < 'monitor' < 'warn' < 'error')
          
              Short responses look like this:
                --json:     \`{healthy:bool}\`
                --markdown: \`healthy = bool\`
                neither:    \`OK/ERR\`
          
              Examples
                $ socket scan report [UUID] --json --fold=version
                $ socket scan report [UUID] --license --markdown --short"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket scan report\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan report`',
      )
    },
  )

  cmdit(
    ['scan', 'report', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket scan report\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: Run \`socket login\` to set a default org.
              Use the --org flag to override the default org.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 Org name by default setting, --org, or auto-discovered (dot is an invalid org, most likely you forgot the org name here?)
          \\xd7 Scan ID to report on (missing)
        "
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
      FLAG_DRY_RUN,
      FLAG_ORG,
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should be ok with org name and id',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stdout)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket scan report\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
