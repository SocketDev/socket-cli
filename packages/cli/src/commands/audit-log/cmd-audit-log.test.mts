import { describe, expect } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_ORG,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

const binCliPath = getBinCliPath()

describe('socket audit-log', async () => {
  cmdit(
    ['audit-log', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Look up the audit log for an organization

          Usage
                $ socket audit-log [options] [FILTER]
          
              API Token Requirements
                - Quota: 1 unit
                - Permissions: audit-log:list
          
              This feature requires an Enterprise Plan. To learn more about getting access
              to this feature and many more, please visit the Socket pricing page (https://socket.dev/pricing).
          
              The type FILTER arg is an enum. Defaults to any. It should be one of these:
                associateLabel, cancelInvitation, changeMemberRole, changePlanSubscriptionSeats,
                createApiToken, createLabel, deleteLabel, deleteLabelSetting, deleteReport,
                deleteRepository, disassociateLabel, joinOrganization, removeMember,
                resetInvitationLink, resetOrganizationSettingToDefault, rotateApiToken,
                sendInvitation, setLabelSettingToDefault, syncOrganization, transferOwnership,
                updateAlertTriage, updateApiTokenCommitter, updateApiTokenMaxQuota,
                updateApiTokenName', updateApiTokenScopes, updateApiTokenVisibility,
                updateLabelSetting, updateOrganizationSetting, upgradeOrganizationPlan
          
              The page arg should be a positive integer, offset 1. Defaults to 1.
          
              Options
                --interactive       Allow for interactive elements, asking for input.
                                    Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
                --json              Output as JSON
                --markdown          Output as Markdown
                --org               Force override the organization slug, overrides the default org from config
                --page              Result page to fetch
                --per-page          Results per page - default is 30
          
              Examples
                $ socket audit-log
                $ socket audit-log deleteReport --page 2 --per-page 10"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket audit-log\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket audit-log`',
      )
    },
  )

  cmdit(
    ['audit-log', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should report missing org name',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket audit-log\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: Run \`socket login\` to set a default org.
              Use the --org flag to override the default org.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 Org name by default setting, --org, or auto-discovered (missing)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'audit-log',
      '--type',
      'xyz',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken", "defaultOrg": "fakeOrg"}',
    ],
    'should report legacy flag',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket audit-log\`, cwd: <redacted>

        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 Legacy flags are no longer supported. See the v1 migration guide (https://docs.socket.dev/docs/v1-migration-guide). (received legacy flags)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'audit-log',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken", "defaultOrg": "fakeOrg"}',
    ],
    'should accept default org',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket audit-log\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'audit-log',
      FLAG_ORG,
      'forcedorg',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --org flag in v1',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket audit-log\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
