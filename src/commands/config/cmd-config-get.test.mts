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
      expect(stdout).toMatchInlineSnapshot(`""`)
      // Node 24 on Windows currently fails this test with added stderr:
      // Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
      const skipOnWin32Node24 =
        constants.WIN32 && semver.parse(constants.NODE_VERSION)!.major >= 24
      if (!skipOnWin32Node24) {
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             node:internal/modules/cjs/loader:1423
            throw err;
            ^

          Error: Cannot find module './external/ink'
          Require stack:
          - /Users/jdalton/projects/socket-cli/dist/utils.js
          - /Users/jdalton/projects/socket-cli/dist/cli.js
              at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
              at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
              at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
              at Module._load (node:internal/modules/cjs/loader:1226:37)
              at TracingChannel.traceSync (node:diagnostics_channel:322:14)
              at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
              at Module.require (node:internal/modules/cjs/loader:1503:12)
              at require (node:internal/modules/helpers:152:16)
              at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
              at Module._compile (node:internal/modules/cjs/loader:1760:14) {
            code: 'MODULE_NOT_FOUND',
            requireStack: [
              '/Users/jdalton/projects/socket-cli/dist/utils.js',
              '/Users/jdalton/projects/socket-cli/dist/cli.js'
            ]
          }

          Node.js v24.8.0"
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
           node:internal/modules/cjs/loader:1423
          throw err;
          ^

        Error: Cannot find module './external/ink'
        Require stack:
        - /Users/jdalton/projects/socket-cli/dist/utils.js
        - /Users/jdalton/projects/socket-cli/dist/cli.js
            at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
            at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
            at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
            at Module._load (node:internal/modules/cjs/loader:1226:37)
            at TracingChannel.traceSync (node:diagnostics_channel:322:14)
            at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
            at Module.require (node:internal/modules/cjs/loader:1503:12)
            at require (node:internal/modules/helpers:152:16)
            at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
            at Module._compile (node:internal/modules/cjs/loader:1760:14) {
          code: 'MODULE_NOT_FOUND',
          requireStack: [
            '/Users/jdalton/projects/socket-cli/dist/utils.js',
            '/Users/jdalton/projects/socket-cli/dist/cli.js'
          ]
        }

        Node.js v24.8.0"
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
        `""`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           node:internal/modules/cjs/loader:1423
          throw err;
          ^

        Error: Cannot find module './external/ink'
        Require stack:
        - /Users/jdalton/projects/socket-cli/dist/utils.js
        - /Users/jdalton/projects/socket-cli/dist/cli.js
            at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
            at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
            at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
            at Module._load (node:internal/modules/cjs/loader:1226:37)
            at TracingChannel.traceSync (node:diagnostics_channel:322:14)
            at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
            at Module.require (node:internal/modules/cjs/loader:1503:12)
            at require (node:internal/modules/helpers:152:16)
            at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
            at Module._compile (node:internal/modules/cjs/loader:1760:14) {
          code: 'MODULE_NOT_FOUND',
          requireStack: [
            '/Users/jdalton/projects/socket-cli/dist/utils.js',
            '/Users/jdalton/projects/socket-cli/dist/cli.js'
          ]
        }

        Node.js v24.8.0"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               node:internal/modules/cjs/loader:1423
              throw err;
              ^

            Error: Cannot find module './external/ink'
            Require stack:
            - /Users/jdalton/projects/socket-cli/dist/utils.js
            - /Users/jdalton/projects/socket-cli/dist/cli.js
                at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:322:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
                at Module.require (node:internal/modules/cjs/loader:1503:12)
                at require (node:internal/modules/helpers:152:16)
                at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
                at Module._compile (node:internal/modules/cjs/loader:1760:14) {
              code: 'MODULE_NOT_FOUND',
              requireStack: [
                '/Users/jdalton/projects/socket-cli/dist/utils.js',
                '/Users/jdalton/projects/socket-cli/dist/cli.js'
              ]
            }

            Node.js v24.8.0"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               node:internal/modules/cjs/loader:1423
              throw err;
              ^

            Error: Cannot find module './external/ink'
            Require stack:
            - /Users/jdalton/projects/socket-cli/dist/utils.js
            - /Users/jdalton/projects/socket-cli/dist/cli.js
                at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:322:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
                at Module.require (node:internal/modules/cjs/loader:1503:12)
                at require (node:internal/modules/helpers:152:16)
                at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
                at Module._compile (node:internal/modules/cjs/loader:1760:14) {
              code: 'MODULE_NOT_FOUND',
              requireStack: [
                '/Users/jdalton/projects/socket-cli/dist/utils.js',
                '/Users/jdalton/projects/socket-cli/dist/cli.js'
              ]
            }

            Node.js v24.8.0"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               node:internal/modules/cjs/loader:1423
              throw err;
              ^

            Error: Cannot find module './external/ink'
            Require stack:
            - /Users/jdalton/projects/socket-cli/dist/utils.js
            - /Users/jdalton/projects/socket-cli/dist/cli.js
                at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:322:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
                at Module.require (node:internal/modules/cjs/loader:1503:12)
                at require (node:internal/modules/helpers:152:16)
                at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
                at Module._compile (node:internal/modules/cjs/loader:1760:14) {
              code: 'MODULE_NOT_FOUND',
              requireStack: [
                '/Users/jdalton/projects/socket-cli/dist/utils.js',
                '/Users/jdalton/projects/socket-cli/dist/cli.js'
              ]
            }

            Node.js v24.8.0"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               node:internal/modules/cjs/loader:1423
              throw err;
              ^

            Error: Cannot find module './external/ink'
            Require stack:
            - /Users/jdalton/projects/socket-cli/dist/utils.js
            - /Users/jdalton/projects/socket-cli/dist/cli.js
                at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:322:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
                at Module.require (node:internal/modules/cjs/loader:1503:12)
                at require (node:internal/modules/helpers:152:16)
                at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
                at Module._compile (node:internal/modules/cjs/loader:1760:14) {
              code: 'MODULE_NOT_FOUND',
              requireStack: [
                '/Users/jdalton/projects/socket-cli/dist/utils.js',
                '/Users/jdalton/projects/socket-cli/dist/cli.js'
              ]
            }

            Node.js v24.8.0"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               node:internal/modules/cjs/loader:1423
              throw err;
              ^

            Error: Cannot find module './external/ink'
            Require stack:
            - /Users/jdalton/projects/socket-cli/dist/utils.js
            - /Users/jdalton/projects/socket-cli/dist/cli.js
                at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:322:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
                at Module.require (node:internal/modules/cjs/loader:1503:12)
                at require (node:internal/modules/helpers:152:16)
                at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
                at Module._compile (node:internal/modules/cjs/loader:1760:14) {
              code: 'MODULE_NOT_FOUND',
              requireStack: [
                '/Users/jdalton/projects/socket-cli/dist/utils.js',
                '/Users/jdalton/projects/socket-cli/dist/cli.js'
              ]
            }

            Node.js v24.8.0"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               node:internal/modules/cjs/loader:1423
              throw err;
              ^

            Error: Cannot find module './external/ink'
            Require stack:
            - /Users/jdalton/projects/socket-cli/dist/utils.js
            - /Users/jdalton/projects/socket-cli/dist/cli.js
                at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:322:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
                at Module.require (node:internal/modules/cjs/loader:1503:12)
                at require (node:internal/modules/helpers:152:16)
                at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
                at Module._compile (node:internal/modules/cjs/loader:1760:14) {
              code: 'MODULE_NOT_FOUND',
              requireStack: [
                '/Users/jdalton/projects/socket-cli/dist/utils.js',
                '/Users/jdalton/projects/socket-cli/dist/cli.js'
              ]
            }

            Node.js v24.8.0"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               node:internal/modules/cjs/loader:1423
              throw err;
              ^

            Error: Cannot find module './external/ink'
            Require stack:
            - /Users/jdalton/projects/socket-cli/dist/utils.js
            - /Users/jdalton/projects/socket-cli/dist/cli.js
                at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:322:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
                at Module.require (node:internal/modules/cjs/loader:1503:12)
                at require (node:internal/modules/helpers:152:16)
                at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
                at Module._compile (node:internal/modules/cjs/loader:1760:14) {
              code: 'MODULE_NOT_FOUND',
              requireStack: [
                '/Users/jdalton/projects/socket-cli/dist/utils.js',
                '/Users/jdalton/projects/socket-cli/dist/cli.js'
              ]
            }

            Node.js v24.8.0"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               node:internal/modules/cjs/loader:1423
              throw err;
              ^

            Error: Cannot find module './external/ink'
            Require stack:
            - /Users/jdalton/projects/socket-cli/dist/utils.js
            - /Users/jdalton/projects/socket-cli/dist/cli.js
                at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:322:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
                at Module.require (node:internal/modules/cjs/loader:1503:12)
                at require (node:internal/modules/helpers:152:16)
                at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
                at Module._compile (node:internal/modules/cjs/loader:1760:14) {
              code: 'MODULE_NOT_FOUND',
              requireStack: [
                '/Users/jdalton/projects/socket-cli/dist/utils.js',
                '/Users/jdalton/projects/socket-cli/dist/cli.js'
              ]
            }

            Node.js v24.8.0"
          `)

          // No token in the config override.
          expect(stdout).toContain('apiToken: undefined')
        },
      )
    })
  })
})
