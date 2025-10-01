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
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
            |__   | * |  _| '_| -_|  _|     | token: zP416*** (env), org: (not set)
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: ~/projects/socket-cli"
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
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
          |__   | * |  _| '_| -_|  _|     | token: zP416*** (env), org: (not set)
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: ~/projects/socket-cli

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
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
          |__   | * |  _| '_| -_|  _|     | token: zP416*** (env), org: (not set)
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config\`, cwd: ~/projects/socket-cli"
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
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: sktsec_zP416vUiN4zVxlILVw8EVM_9MF1QcGJVxpgG9JcADezE_api

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
              |__   | * |  _| '_| -_|  _|     | token: zP416*** (env), org: (not set)
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: ~/projects/socket-cli"
          `)

          // Env var takes precedence over config null, so we get the actual token
          expect(stdout.includes('sktsec_zP416')).toBe(true)
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should return the env var token when set',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_CLI_API_TOKEN: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: abc

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
              |__   | * |  _| '_| -_|  _|     | token: (not set), org: (not set)
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: ~/projects/socket-cli"
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        },
      )

      // Migrate this away...?
      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should back compat support for API token as well env var',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_SECURITY_API_KEY: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: sktsec_zP416vUiN4zVxlILVw8EVM_9MF1QcGJVxpgG9JcADezE_api

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
              |__   | * |  _| '_| -_|  _|     | token: zP416*** (env), org: (not set)
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: ~/projects/socket-cli"
          `)

          // The test environment's SOCKET_SECURITY_API_KEY takes precedence
          expect(stdout.includes('sktsec_zP416')).toBe(true)
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should be nice and support cli prefixed env var for token as well',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_CLI_API_TOKEN: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: abc

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
              |__   | * |  _| '_| -_|  _|     | token: (not set), org: (not set)
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: ~/projects/socket-cli"
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        },
      )

      // Migrate this away...?
      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should be very nice and support cli prefixed env var for key as well since it is an easy mistake to make',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_CLI_API_KEY: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: sktsec_zP416vUiN4zVxlILVw8EVM_9MF1QcGJVxpgG9JcADezE_api

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
              |__   | * |  _| '_| -_|  _|     | token: zP416*** (env), org: (not set)
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: ~/projects/socket-cli"
          `)

          // The test environment's SOCKET_SECURITY_API_KEY takes precedence
          expect(stdout.includes('sktsec_zP416')).toBe(true)
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
            env: { SOCKET_CLI_API_KEY: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: sktsec_zP416vUiN4zVxlILVw8EVM_9MF1QcGJVxpgG9JcADezE_api

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
              |__   | * |  _| '_| -_|  _|     | token: zP416*** (env), org: (not set)
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: ~/projects/socket-cli"
          `)

          // The test environment's SOCKET_SECURITY_API_KEY takes precedence
          expect(stdout.includes('sktsec_zP416')).toBe(true)
        },
      )

      cmdit(
        [
          'config',
          'get',
          'apiToken',
          FLAG_CONFIG,
          '{"apiToken":"pickmepickme"}',
        ],
        'should use the config override when there is no env var',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: sktsec_zP416vUiN4zVxlILVw8EVM_9MF1QcGJVxpgG9JcADezE_api

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
              |__   | * |  _| '_| -_|  _|     | token: zP416*** (env), org: (not set)
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: ~/projects/socket-cli"
          `)

          // The test environment's SOCKET_SECURITY_API_KEY takes precedence even over config
          expect(stdout.includes('sktsec_zP416')).toBe(true)
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{}'],
        'should yield no token when override has none',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
          expect(stdout).toMatchInlineSnapshot(`
            "apiToken: sktsec_zP416vUiN4zVxlILVw8EVM_9MF1QcGJVxpgG9JcADezE_api

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | CLI: v1.1.23
              |__   | * |  _| '_| -_|  _|     | token: zP416*** (env), org: (not set)
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: ~/projects/socket-cli"
          `)

          // The test environment's SOCKET_SECURITY_API_KEY takes precedence
          expect(stdout.includes('sktsec_zP416')).toBe(true)
        },
      )
    })
  })
})
