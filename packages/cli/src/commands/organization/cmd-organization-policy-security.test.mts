import { describe, expect } from 'vitest'

import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_ORG,
} from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket organization policy security', async () => {
  cmdit(
    ['organization', 'policy', 'security', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const {
        code: _code,
        stderr,
        stdout,
      } = await spawnSocketCli(binCliPath, cmd)
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

      //expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket organization policy security`',
      )
    },
  )

  cmdit(
    ['organization', 'policy', 'security', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should reject dry run without proper args',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      // expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      //   "
      //      _____         _       _        /---------------
      //     |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
      //     |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
      //     |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy security\`, cwd: <redacted>

      //   \\u203c Unable to determine the target org. Trying to auto-discover it now...
      //   i Note: you can run \`socket login\` to set a default org. You can also override it with the --org flag.

      //   \\xd7 Skipping auto-discovery of org in dry-run mode
      //   \\xd7  Input error:  Please review the input requirements and try again

      //     - You need to be logged in to use this command. See \`socket login\`. (missing API token)
      //   "
      // `)

      expect(code, 'dry-run should exit with code 2 if input bad').toBe(2)
    },
  )

  cmdit(
    [
      'organization',
      'policy',
      'security',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"isTestingV1": true, "apiToken":"fakeToken", "defaultOrg": "fakeOrg"}',
    ],
    'should accept default org in v1',
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

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'organization',
      'policy',
      'security',
      FLAG_ORG,
      'forcedorg',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"isTestingV1": true, "apiToken":"fakeToken"}',
    ],
    'should accept --org flag in v1',
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

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
