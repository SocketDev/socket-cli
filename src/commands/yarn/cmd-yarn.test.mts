import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeAll, describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_QUIET,
  YARN,
} from '../../../src/constants.mts'
import { withTempFixture } from '../../../src/utils/test-fixtures.mts'
import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'

describe('socket yarn', async () => {
  const { binCliPath } = constants
  const fixtureBaseDir = path.join(testPath, 'fixtures/commands/yarn')
  const yarnMinimalFixture = path.join(fixtureBaseDir, 'minimal')
  let testCwd: string

  const cleanupFunctions: Array<() => Promise<void>> = []

  beforeAll(async () => {
    // Create isolated temp directory for tests that don't use fixtures
    testCwd = path.join(
      tmpdir(),
      `socket-yarn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    const { promises: fs } = await import('node:fs')
    await fs.mkdir(testCwd, { recursive: true })
    await fs.writeFile(
      path.join(testCwd, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', private: true }),
    )
  })

  afterEach(async () => {
    await Promise.all(cleanupFunctions.map(cleanup => cleanup()))
    cleanupFunctions.length = 0
  })

  cmdit(
    [YARN, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "Run yarn with Socket Firewall security

          Usage
            $ socket yarn ...

          Note: Everything after "yarn" is forwarded to Socket Firewall (sfw).
                Socket Firewall provides real-time security scanning for yarn packages.

          Examples
            $ socket yarn install
            $ socket yarn add package-name"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket yarn\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket yarn`')
    },
  )

  cmdit(
    [YARN, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      // Run in isolated tmpdir to avoid polluting repo with yarn files
      const { cleanup, tempDir } = await withTempFixture(yarnMinimalFixture)
      cleanupFunctions.push(cleanup)

      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`
        "Protected by Socket Firewall
        \\u27a4 YN0000: \\xb7 Yarn X.X.X
        \\u27a4 YN0000: \\u250c Resolution step
        \\u27a4 YN0000: \\u2514 Completed
        \\u27a4 YN0000: \\u250c Fetch step
        \\u27a4 YN0000: \\u2514 Completed
        \\u27a4 YN0000: \\u250c Link step
        \\u27a4 YN0000: \\u2514 Completed
        \\u27a4 YN0000: \\xb7 Done in Xs XXXms

        === Socket Firewall ==="
      `)
      expect(stderr).toContain('CLI')
      expect(code, 'dry-run without args should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      'add',
      'lodash',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle add with --dry-run flag',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(yarnMinimalFixture)
      cleanupFunctions.push(cleanup)

      const { code } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
        timeout: 30_000,
      })

      expect(code, 'dry-run add should exit with code 0').toBe(0)
    },
  )

  // TODO: Fix test failure - yarn install with --dry-run flag
  // Test may be failing due to yarn-specific behavior or snapshot mismatch
  cmdit(
    [YARN, 'install', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should handle install with --dry-run flag',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(yarnMinimalFixture)
      cleanupFunctions.push(cleanup)

      const { code } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
        timeout: 30_000,
      })

      expect(code, 'dry-run install should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      'add',
      '@types/node@^20.0.0',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle scoped packages with version',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(yarnMinimalFixture)
      cleanupFunctions.push(cleanup)

      const { code } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
        timeout: 30_000,
      })

      expect(code, 'dry-run add scoped package should exit with code 0').toBe(0)
    },
  )
})
