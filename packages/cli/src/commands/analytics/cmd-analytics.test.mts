import semver from 'semver'
import { describe, expect } from 'vitest'

import { getNodeVersion } from '@socketsecurity/lib/constants/node'
import { WIN32 } from '@socketsecurity/lib/constants/platform'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

const binCliPath = getBinCliPath()

describe('socket analytics', async () => {
  cmdit(
    ['analytics', FLAG_HELP, FLAG_CONFIG, '{}'],
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
        '`socket analytics`',
      )
    },
  )

  cmdit(
    ['analytics', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should report missing token with just dry-run',
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
      'analytics',
      '--scope',
      'org',
      '--repo',
      'bar',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should reject legacy flags',
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

      expect(code, 'dry-run should reject legacy flags with code 2').toBe(2)
    },
  )

  cmdit(
    ['analytics', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should run to dryrun without args',
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
    ['analytics', 'org', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should accept org arg',
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
      'analytics',
      'repo',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should ask for repo name with repo arg',
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
      'analytics',
      'repo',
      'daname',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept repo with arg',
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
    ['analytics', '7', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should accept time 7 arg',
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
    ['analytics', '30', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should accept time 30 arg',
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
    ['analytics', '90', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should accept time 90 arg',
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
      'analytics',
      'org',
      '--time',
      '7',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should report legacy flag',
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
      'analytics',
      'org',
      '7',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept org and time arg',
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
      'analytics',
      'repo',
      'slowpo',
      '30',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept repo and time arg',
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
