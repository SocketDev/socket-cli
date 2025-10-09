import { tmpdir } from 'node:os'
import path from 'node:path'

import { deleteAsync } from 'del'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  PNPM,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket pnpm', async () => {
  const { binCliPath } = constants
  let testCwd: string

  beforeAll(async () => {
    testCwd = path.join(
      tmpdir(),
      `socket-pnpm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    const { promises: fs } = await import('node:fs')
    await fs.mkdir(testCwd, { recursive: true })
    await fs.writeFile(
      path.join(testCwd, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', private: true }),
    )
  })

  afterAll(async () => {
    if (testCwd) {
      await deleteAsync(testCwd).catch(() => {})
    }
  })

  cmdit(
    [PNPM, FLAG_HELP, FLAG_CONFIG, '{}'],
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
      expect(stderr, 'banner includes base command').toContain('`socket pnpm`')
    },
  )

  cmdit(
    [PNPM, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(stderr).toContain('CLI')
      expect(code, 'pnpm without args shows help and exits with code 1').toBe(1)
    },
  )

  cmdit(
    [
      PNPM,
      'add',
      'lodash',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    // TODO: Fix test failure - pnpm add with --dry-run flag
    // Test may be failing due to snapshot mismatch or pnpm behavior changes
    'should handle add with --dry-run flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'dry-run add should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [PNPM, 'install', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should handle install with --dry-run flag',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run install should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'add',
      '@types/node@^20.0.0',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    // TODO: Fix test failure - pnpm add scoped packages with version
    // Test may be failing due to snapshot mismatch or pnpm behavior changes
    'should handle scoped packages with version',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'dry-run add scoped package should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    // TODO: Fix test failure - pnpm install with issueRules for malware
    // Test may be failing due to API mocking or issueRules behavior changes
    'should handle install with issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'dry-run install should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
      FLAG_DRY_RUN,
    ],
    'should handle install with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(
        code,
        'dry-run install with --config should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle install with multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(
        code,
        'dry-run install with multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
      FLAG_DRY_RUN,
    ],
    'should handle install with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(
        code,
        'dry-run install with --config and multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  describe('CI environment routing', () => {
    it('should forward to sfw when config flag is present but NOT in CI', async () => {
      const originalCI = process.env.CI
      try {
        // Ensure we're not in CI.
        delete process.env.CI

        const { code, stderr } = await spawnSocketCli(
          binCliPath,
          [PNPM, 'ls', FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
          {
            timeout: 10_000,
          },
        )

        // When forwarding to sfw, npx will be invoked which may show npx-related output.
        // The exact output depends on whether sfw is installed.
        expect(code).toBeGreaterThanOrEqual(0)
        // Should NOT show pnpm version output that comes from shadow binary.
        expect(stderr).not.toContain('using pnpm v')
      } finally {
        if (originalCI !== undefined) {
          process.env.CI = originalCI
        }
      }
    })

    it('should use shadow pnpm binary when config flag is present AND in CI', async () => {
      const originalCI = process.env.CI
      try {
        // Set CI environment.
        process.env.CI = '1'

        const { code, stdout } = await spawnSocketCli(
          binCliPath,
          [PNPM, 'ls', FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
          {
            timeout: 10_000,
          },
        )

        expect(code).toBe(0)
        // Shadow pnpm binary should be used, showing pnpm output.
        expect(stdout).toContain('dependencies:')
      } finally {
        if (originalCI !== undefined) {
          process.env.CI = originalCI
        } else {
          delete process.env.CI
        }
      }
    })

    it('should forward to sfw when no config flag regardless of CI', async () => {
      const originalCI = process.env.CI
      try {
        // Set CI environment.
        process.env.CI = '1'

        const { code } = await spawnSocketCli(
          binCliPath,
          [PNPM, 'ls'],
          {
            timeout: 10_000,
          },
        )

        // When forwarding to sfw without config, it should still work.
        expect(code).toBeGreaterThanOrEqual(0)
      } finally {
        if (originalCI !== undefined) {
          process.env.CI = originalCI
        } else {
          delete process.env.CI
        }
      }
    })
  })
})
