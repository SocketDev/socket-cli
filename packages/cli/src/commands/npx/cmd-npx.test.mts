import { describe, expect } from 'vitest'

import { NPX } from '@socketsecurity/lib/constants/agents'

import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_SILENT,
} from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket npx', async () => {
  cmdit(
    [NPX, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
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

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket npx`')
    },
  )

  cmdit(
    [NPX, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
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

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'npx',
      FLAG_SILENT,
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle npx with version',
    async cmd => {
      const {
        code,
        stderr: _stderr,
        stdout: _stdout,
      } = await spawnSocketCli(binCliPath, cmd)
      expect(code, 'dry-run npx should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'npx',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle npx with -c flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'dry-run npx with -c should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'npx',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle npx with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'dry-run npx with --config should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'npx',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle npx with -c flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(
        code,
        'dry-run npx with multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'npx',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle npx with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(
        code,
        'dry-run npx with --config and multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )
})
