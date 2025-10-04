import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket config', async () => {
  const { binCliPath } = constants

  cmdit(
    ['config', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Manage Socket CLI configuration

          Usage
            $ socket config <command>

          Commands
            auto                        Automatically discover and set the correct value config item
            get                         Get the value of a local CLI config item
            list                        Show all local CLI config items and their values
            set                         Update the value of a local CLI config item
            unset                       Clear the value of a local CLI config item

          Options

            --no-banner                 Hide the Socket banner
            --no-spinner                Hide the console spinner"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket config`',
      )
    },
  )

  cmdit(
    ['config', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        usage: socketcli [-h] [--api-token <token>] [--repo <owner/repo>]
                         [--repo-is-public] [--branch <name>] [--integration <type>]
                         [--owner <name>] [--pr-number <number>]
                         [--commit-message <message>] [--commit-sha <sha>]
                         [--committers [<name> ...]] [--target-path <path>]
                         [--sbom-file <path>] [--license-file-name <string>]
                         [--save-submitted-files-list <path>]
                         [--save-manifest-tar <path>] [--files <json>]
                         [--sub-path <path>] [--workspace-name <name>]
                         [--excluded-ecosystems EXCLUDED_ECOSYSTEMS]
                         [--default-branch] [--pending-head] [--generate-license]
                         [--enable-debug] [--enable-json] [--enable-sarif]
                         [--disable-overview] [--exclude-license-details]
                         [--allow-unverified] [--disable-security-issue]
                         [--ignore-commit-files] [--disable-blocking] [--enable-diff]
                         [--scm <type>] [--timeout <seconds>]
                         [--include-module-folders] [--version]
        socketcli: error: unrecognized arguments: --dry-run --config {"apiToken":"fakeToken"}
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  describe('config override', () => {
    cmdit(
      ['config', 'get', 'apiToken'],
      'should print nice error when env config override cannot be parsed',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          // This will be parsed first. If it fails it should fallback to flag or empty.
          env: { SOCKET_CLI_CONFIG: '{apiToken:invalidjson}' },
        })
        expect(stdout).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
          \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
          \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
          \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | CLI: <redacted>
            |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>

          \\xd7 Could not parse Config as JSON"
        `)

        expect(stderr.includes('Could not parse Config as JSON')).toBe(true)
        expect(code, 'bad config input should exit with code 2 ').toBe(2)
      },
    )

    cmdit(
      ['config', 'get', 'apiToken', FLAG_CONFIG, '{apiToken:invalidjson}'],
      'should print nice error when flag config override cannot be parsed',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(stdout).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
          \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
          \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
          \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | CLI: <redacted>
            |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>

          \\xd7 Could not parse Config as JSON"
        `)

        expect(stderr.includes('Could not parse Config as JSON')).toBe(true)
        expect(code, 'bad config input should exit with code 2 ').toBe(2)
      },
    )
  })
})
