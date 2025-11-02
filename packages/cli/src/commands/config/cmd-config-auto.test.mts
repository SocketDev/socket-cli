import { describe, expect } from 'vitest'

import { expectDryRunOutput } from '../../../test/helpers/output-assertions.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_DRY_RUN, FLAG_HELP } from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket config auto', async () => {
  cmdit(
    ['config', 'auto', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Automatically discover and set the correct value config item

          Usage
                $ socket config auto [options] KEY
          
              Options
                --json              Output as JSON
                --markdown          Output as Markdown
          
              Attempt to automatically discover the correct value for a given config KEY.
          
              Examples
                $ socket config auto defaultOrg
          
              Keys:
               - apiBaseUrl -- Base URL of the Socket API endpoint
               - apiProxy -- A proxy through which to access the Socket API
               - apiToken -- The Socket API token required to access most Socket API endpoints
               - defaultOrg -- The default org slug to use; usually the org your Socket API token has access to. When set, all orgSlug arguments are implied to be this value.
               - enforcedOrgs -- Orgs in this list have their security policies enforced on this machine
               - org -- Alias for defaultOrg
               - skipAskToPersistDefaultOrg -- This flag prevents the Socket CLI from asking you to persist the org slug when you selected one interactively"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket config auto\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket config auto`',
      )
    },
  )

  cmdit(
    [
      'config',
      'auto',
      'defaultOrg',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
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
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket config auto\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
