import semver from 'semver'
import { describe, expect } from 'vitest'

import { getNodeVersion } from '@socketsecurity/lib/constants/node'
import { WIN32 } from '@socketsecurity/lib/constants/platform'

import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_DRY_RUN, FLAG_HELP } from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket config get', async () => {
  cmdit(
    ['config', 'get', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      // Node 24 on Windows currently fails this test with added stderr:
      // Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
      const skipOnWin32Node24 =
        WIN32 && semver.parse(getNodeVersion())?.major >= 24
      if (!skipOnWin32Node24) {
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
              at exportsNotFound (node:internal/modules/esm/resolve:313:10)
              at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
              at resolveExports (node:internal/modules/cjs/loader:678:36)
              at Module._findPath (node:internal/modules/cjs/loader:745:31)
              at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
              at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
              at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
              at Module._load (node:internal/modules/cjs/loader:1226:37)
              at TracingChannel.traceSync (node:diagnostics_channel:328:14)
              at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
            code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
          }"
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
           Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
            at exportsNotFound (node:internal/modules/esm/resolve:313:10)
            at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
            at resolveExports (node:internal/modules/cjs/loader:678:36)
            at Module._findPath (node:internal/modules/cjs/loader:745:31)
            at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
            at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
            at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
            at Module._load (node:internal/modules/cjs/loader:1226:37)
            at TracingChannel.traceSync (node:diagnostics_channel:328:14)
            at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
          code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
        }"
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
           Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
            at exportsNotFound (node:internal/modules/esm/resolve:313:10)
            at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
            at resolveExports (node:internal/modules/cjs/loader:678:36)
            at Module._findPath (node:internal/modules/cjs/loader:745:31)
            at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
            at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
            at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
            at Module._load (node:internal/modules/cjs/loader:1226:37)
            at TracingChannel.traceSync (node:diagnostics_channel:328:14)
            at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
          code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
        }"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
                at exportsNotFound (node:internal/modules/esm/resolve:313:10)
                at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
                at resolveExports (node:internal/modules/cjs/loader:678:36)
                at Module._findPath (node:internal/modules/cjs/loader:745:31)
                at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:328:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
              code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
            }"
          `)

          expect(stdout.includes('apiToken: null')).toBe(true)
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should return the env var token when set',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_CLI_API_TOKEN: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
                at exportsNotFound (node:internal/modules/esm/resolve:313:10)
                at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
                at resolveExports (node:internal/modules/cjs/loader:678:36)
                at Module._findPath (node:internal/modules/cjs/loader:745:31)
                at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:328:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
              code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
            }"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
                at exportsNotFound (node:internal/modules/esm/resolve:313:10)
                at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
                at resolveExports (node:internal/modules/cjs/loader:678:36)
                at Module._findPath (node:internal/modules/cjs/loader:745:31)
                at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:328:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
              code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
            }"
          `)

          // SOCKET_SECURITY_API_KEY is now supported
          expect(stdout.includes('apiToken: abc')).toBe(true)
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should be nice and support cli prefixed env var for token as well',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_CLI_API_TOKEN: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
                at exportsNotFound (node:internal/modules/esm/resolve:313:10)
                at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
                at resolveExports (node:internal/modules/cjs/loader:678:36)
                at Module._findPath (node:internal/modules/cjs/loader:745:31)
                at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:328:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
              code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
            }"
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
                at exportsNotFound (node:internal/modules/esm/resolve:313:10)
                at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
                at resolveExports (node:internal/modules/cjs/loader:678:36)
                at Module._findPath (node:internal/modules/cjs/loader:745:31)
                at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:328:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
              code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
            }"
          `)

          // SOCKET_CLI_API_KEY is now supported as fallback
          expect(stdout.includes('apiToken: abc')).toBe(true)
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
                at exportsNotFound (node:internal/modules/esm/resolve:313:10)
                at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
                at resolveExports (node:internal/modules/cjs/loader:678:36)
                at Module._findPath (node:internal/modules/cjs/loader:745:31)
                at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:328:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
              code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
            }"
          `)

          // Env var fallback now takes precedence
          expect(stdout.includes('apiToken: abc')).toBe(true)
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
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
                at exportsNotFound (node:internal/modules/esm/resolve:313:10)
                at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
                at resolveExports (node:internal/modules/cjs/loader:678:36)
                at Module._findPath (node:internal/modules/cjs/loader:745:31)
                at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:328:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
              code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
            }"
          `)

          expect(stdout.includes('apiToken: pickmepickme')).toBe(true)
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{}'],
        'should yield no token when override has none',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
                at exportsNotFound (node:internal/modules/esm/resolve:313:10)
                at packageExportsResolve (node:internal/modules/esm/resolve:661:9)
                at resolveExports (node:internal/modules/cjs/loader:678:36)
                at Module._findPath (node:internal/modules/cjs/loader:745:31)
                at Module._resolveFilename (node:internal/modules/cjs/loader:1405:27)
                at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
                at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
                at Module._load (node:internal/modules/cjs/loader:1226:37)
                at TracingChannel.traceSync (node:diagnostics_channel:328:14)
                at wrapModuleLoad (node:internal/modules/cjs/loader:244:24) {
              code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
            }"
          `)

          expect(stdout.includes('apiToken: undefined')).toBe(true)
        },
      )
    })
  })
})
