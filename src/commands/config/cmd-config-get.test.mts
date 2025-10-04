import semver from 'semver'
import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket config get', async () => {
  const { binCliPath } = constants

  cmdit(
    ['config', 'get', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Get the value of a local CLI config item

          Usage
            $ socket config get [options] KEY

          Retrieve the value for given KEY at this time. If you have overridden the
          config then the value will come from that override.

          Options
            --json              Output as JSON
            --markdown          Output as Markdown

          KEY is an enum. Valid keys:

           - apiBaseUrl -- Base URL of the Socket API endpoint
           - apiProxy -- A proxy through which to access the Socket API
           - apiToken -- The Socket API token required to access most Socket API endpoints
           - defaultOrg -- The default org slug to use; usually the org your Socket API token has access to. When set, all orgSlug arguments are implied to be this value.
           - enforcedOrgs -- Orgs in this list have their security policies enforced on this machine
           - org -- Alias for defaultOrg
           - skipAskToPersistDefaultOrg -- This flag prevents the Socket CLI from asking you to persist the org slug when you selected one interactively

          Examples
            $ socket config get defaultOrg"
      `)
      // Node 24 on Windows currently fails this test with added stderr:
      // Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
      const skipOnWin32Node24 =
        constants.WIN32 && semver.parse(constants.NODE_VERSION)!.major >= 24
      if (!skipOnWin32Node24) {
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
          \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
          \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
          \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | CLI: <redacted>
            |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
        `)
        expect(code, 'explicit help should exit with code 0').toBe(0)
      }

      expect(stderr, 'banner includes base command').toContain(
        '`socket config get`',
      )
    },
  )

  cmdit(
    ['config', 'get', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
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
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>

        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 Config key should be the first arg (missing)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'config',
      'test',
      'test',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
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
        socketcli: error: unrecognized arguments: test --dry-run --config {"apiToken":"fakeToken"}
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  describe('env vars', () => {
    describe('token', () => {
      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should return undefined when token not set in config',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: {
              SOCKET_SECURITY_API_KEY: '',
              SOCKET_CLI_API_KEY: '',
              SOCKET_CLI_API_TOKEN: '',
            },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: null

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
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
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          // No env var set, config has null.
          expect(stdout).toContain('apiToken: null')
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should return the env var token when set',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: {
              SOCKET_SECURITY_API_KEY: '',
              SOCKET_CLI_API_KEY: '',
              SOCKET_CLI_API_TOKEN: 'fakeToken',
            },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: fakeToken

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
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
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          expect(stdout).toContain('apiToken: fakeToken')
        },
      )

      // Migrate this away...?
      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should back compat support for API token as well env var',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: {
              SOCKET_SECURITY_API_KEY: 'fakeToken',
              SOCKET_CLI_API_KEY: '',
              SOCKET_CLI_API_TOKEN: '',
            },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: fakeToken

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
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
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          // The test sets SOCKET_SECURITY_API_KEY which takes precedence.
          expect(stdout).toContain('apiToken: fakeToken')
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should be nice and support cli prefixed env var for token as well',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: {
              SOCKET_SECURITY_API_KEY: '',
              SOCKET_CLI_API_KEY: '',
              SOCKET_CLI_API_TOKEN: 'fakeToken',
            },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: fakeToken

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
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
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          expect(stdout).toContain('apiToken: fakeToken')
        },
      )

      // Migrate this away...?
      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should be very nice and support cli prefixed env var for key as well since it is an easy mistake to make',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: {
              SOCKET_SECURITY_API_KEY: '',
              SOCKET_CLI_API_KEY: 'fakeToken',
              SOCKET_CLI_API_TOKEN: '',
            },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: fakeToken

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
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
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          // The test sets SOCKET_CLI_API_KEY which takes precedence.
          expect(stdout).toContain('apiToken: fakeToken')
        },
      )

      cmdit(
        [
          'config',
          'get',
          'apiToken',
          FLAG_CONFIG,
          '{"apiToken":"ignoremebecausetheenvvarshouldbemoreimportant"}',
        ],
        'should use the env var token when the config override also has a token set',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: {
              SOCKET_SECURITY_API_KEY: '',
              SOCKET_CLI_API_KEY: 'fakeToken',
              SOCKET_CLI_API_TOKEN: '',
            },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: fakeToken

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
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
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          // The test sets SOCKET_CLI_API_KEY which takes precedence.
          expect(stdout).toContain('apiToken: fakeToken')
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
        'should use the config override when there is no env var',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: {
              SOCKET_SECURITY_API_KEY: '',
              SOCKET_CLI_API_KEY: '',
              SOCKET_CLI_API_TOKEN: '',
            },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: fakeToken

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
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
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          // The config override token should be returned.
          expect(stdout).toContain('apiToken: fakeToken')
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{}'],
        'should yield no token when override has none',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: {
              SOCKET_SECURITY_API_KEY: '',
              SOCKET_CLI_API_KEY: '',
              SOCKET_CLI_API_TOKEN: '',
            },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: undefined

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
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
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          // No token in the config override.
          expect(stdout).toContain('apiToken: undefined')
        },
      )
    })
  })
})
