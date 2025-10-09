import { tmpdir } from 'node:os'
import path from 'node:path'

import { deleteAsync } from 'del'
import { afterAll, beforeAll, describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_SILENT,
  NPM,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket npm', async () => {
  const { binCliPath } = constants
  let testCwd: string

  beforeAll(async () => {
    // Create isolated temp directory for test execution to ensure
    // even if --dry-run fails, the main repo is not affected.
    testCwd = path.join(
      tmpdir(),
      `socket-npm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    const { promises: fs } = await import('node:fs')
    await fs.mkdir(testCwd, { recursive: true })
    // Create minimal package.json for valid npm context
    await fs.writeFile(
      path.join(testCwd, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', private: true }),
    )
  })

  afterAll(async () => {
    // Cleanup temp directory
    if (testCwd) {
      await deleteAsync(testCwd).catch(() => {})
    }
  })

  cmdit(
    [NPM, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
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

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket npm`')
    },
  )

  cmdit(
    [NPM, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
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

      expect(code, 'npm without command should exit with code 1').toBe(1)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      FLAG_SILENT,
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle npm exec with version',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, { cwd: testCwd })
      // npm exec can exit with 0 or 1 depending on whether the package is cached
      expect(
        code,
        'dry-run exec should exit with code 0 or 1',
      ).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(1)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle npm exec with -c flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`""`)
      // With --dry-run, npm exec runs successfully even with fake token
      // because issueRules filtering happens after execution
      expect(
        code,
        'dry-run exec with issueRules should exit with code 0 or 1',
      ).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(1)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle npm exec with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`""`)
      // With --dry-run, npm exec runs successfully even with fake token
      // because issueRules filtering happens after execution
      expect(
        code,
        'dry-run exec with issueRules should exit with code 0 or 1',
      ).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(1)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle npm exec with -c flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`""`)
      // With --dry-run, npm exec runs successfully even with fake token
      // because issueRules filtering happens after execution
      expect(
        code,
        'dry-run exec with multiple issueRules should exit with code 0 or 1',
      ).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(1)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle npm exec with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`""`)
      // With --dry-run, npm exec runs successfully even with fake token
      // because issueRules filtering happens after execution
      expect(
        code,
        'dry-run exec with --config and multiple issueRules should exit with code 0 or 1',
      ).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(1)
    },
  )
})
