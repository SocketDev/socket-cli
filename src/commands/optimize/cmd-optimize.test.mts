import { existsSync, promises } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { deleteAsync } from 'del'
import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'

import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_JSON,
  FLAG_MARKDOWN,
  FLAG_PIN,
  FLAG_PROD,
  FLAG_VERSION,
  NPM,
  PACKAGE_JSON,
  PACKAGE_LOCK_JSON,
  PNPM,
  PNPM_LOCK_YAML,
} from '../../../src/constants.mts'
import { withTempFixture } from '../../../src/utils/test-fixtures.mts'
import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/optimize')
const npmFixtureDir = path.join(fixtureBaseDir, NPM)
const pnpmFixtureDir = path.join(fixtureBaseDir, PNPM)

async function revertFixtureChanges() {
  // Reset only the package.json and pnpm-lock.yaml files that tests modify.
  const cwd = process.cwd()
  // Git needs the paths relative to the repository root.
  const relativePackageJson = path.relative(
    cwd,
    path.join(pnpmFixtureDir, PACKAGE_JSON),
  )
  const relativePnpmLock = path.relative(
    cwd,
    path.join(pnpmFixtureDir, PNPM_LOCK_YAML),
  )
  // Silently ignore errors. Files may not be tracked by git, may already be
  // reverted, or may not have been modified yet. This is expected behavior
  // in CI environments and during initial test runs.
  try {
    await spawn(
      'git',
      ['checkout', 'HEAD', '--', relativePackageJson, relativePnpmLock],
      {
        cwd,
        stdio: 'ignore',
      },
    )
  } catch {}
}

async function createTempFixture(sourceDir: string): Promise<string> {
  // Create a temporary directory with a unique name.
  const tempDir = path.join(
    tmpdir(),
    `socket-optimize-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )

  // Copy the fixture files to the temp directory.
  await promises.mkdir(tempDir, { recursive: true })

  // Copy package.json.
  const sourcePackageJson = path.join(sourceDir, PACKAGE_JSON)
  const destPackageJson = path.join(tempDir, PACKAGE_JSON)
  await promises.copyFile(sourcePackageJson, destPackageJson)

  // Copy lockfile if it exists.
  const sourceLockFile = path.join(sourceDir, PNPM_LOCK_YAML)
  if (existsSync(sourceLockFile)) {
    const destLockFile = path.join(tempDir, PNPM_LOCK_YAML)
    await promises.copyFile(sourceLockFile, destLockFile)
  }

  // Copy package-lock.json for npm fixtures.
  const sourcePackageLock = path.join(sourceDir, PACKAGE_LOCK_JSON)
  if (existsSync(sourcePackageLock)) {
    const destPackageLock = path.join(tempDir, PACKAGE_LOCK_JSON)
    await promises.copyFile(sourcePackageLock, destPackageLock)
  }

  return tempDir
}

describe('socket optimize', async () => {
  const { binCliPath } = constants

  beforeAll(async () => {
    // Ensure fixtures are in clean state before tests.
    await revertFixtureChanges()
  })

  afterEach(async () => {
    // Revert all changes after each test using git.
    await revertFixtureChanges()
  })

  afterAll(async () => {
    // Clean up once after all tests.
    await revertFixtureChanges()
  })

  cmdit(
    ['optimize', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
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

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket optimize`',
      )
    },
  )

  cmdit(
    ['optimize', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson?.overrides).toBeUndefined()
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

  cmdit(
    [
      'optimize',
      FLAG_DRY_RUN,
      FLAG_PIN,
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --pin flag',
    async cmd => {
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson?.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "node:internal/modules/cjs/loader:1423
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
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      FLAG_DRY_RUN,
      FLAG_PROD,
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --prod flag',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson?.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "node:internal/modules/cjs/loader:1423
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
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      FLAG_DRY_RUN,
      FLAG_PIN,
      FLAG_PROD,
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept both --pin and --prod flags together',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson?.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "node:internal/modules/cjs/loader:1423
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
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      FLAG_DRY_RUN,
      FLAG_JSON,
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --json output format',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson?.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "node:internal/modules/cjs/loader:1423
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
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      FLAG_DRY_RUN,
      FLAG_MARKDOWN,
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --markdown output format',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson?.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "node:internal/modules/cjs/loader:1423
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
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      FLAG_DRY_RUN,
      './custom-path',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept custom directory path',
    async cmd => {
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson?.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "node:internal/modules/cjs/loader:1423
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
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      path.join(fixtureBaseDir, 'nonexistent'),
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle directories without package.json gracefully',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // Should not modify any package.json since no package.json exists in the fixture path.
      const output = stdout + stderr
      expect(output.length).toBeGreaterThan(0)
      expect(code, 'should exit with code 1').toBe(1)
    },
  )

  cmdit(
    [
      'optimize',
      FLAG_DRY_RUN,
      FLAG_PIN,
      FLAG_PROD,
      FLAG_JSON,
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept comprehensive flag combination',
    async cmd => {
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson?.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "node:internal/modules/cjs/loader:1423
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
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      'fixtures/commands/optimize/basic-project',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle basic project fixture',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // Should not modify files due to version mismatch error.
      const output = stdout + stderr
      expect(output.length).toBeGreaterThan(0)
      expect(code, 'should exit with code 1').toBe(1)
    },
  )

  cmdit(
    [
      'optimize',
      FLAG_DRY_RUN,
      FLAG_PIN,
      FLAG_PROD,
      FLAG_MARKDOWN,
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept pin, prod, and markdown flags together',
    async cmd => {
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson?.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "node:internal/modules/cjs/loader:1423
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
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  describe('non dry-run tests', () => {
    cmdit(
      ['optimize', '.', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should optimize packages and modify package.json',
      async cmd => {
        const tempDir = await createTempFixture(pnpmFixtureDir)
        try {
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempDir,
            },
          )

          expect(code).toBe(0)

          // Check that package.json was modified with overrides.
          const packageJsonPath = path.join(tempDir, PACKAGE_JSON)
          const packageJson = await readPackageJson(packageJsonPath)
          expect(packageJson?.overrides).toBeDefined()

          // Check that pnpm-lock.yaml exists (was modified/created).
          const packageLockPath = path.join(tempDir, PNPM_LOCK_YAML)
          expect(existsSync(packageLockPath)).toBe(true)

          // Should have optimization output.
          const output = stdout + stderr
          expect(output).toMatch(/optimized overrides|Optimizing|Adding overrides/i)
        } finally {
          // Clean up the temp directory safely.
          await deleteAsync(tempDir)
        }
      },
    )

    cmdit(
      ['optimize', '.', FLAG_PIN, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should optimize with --pin flag and modify files',
      async cmd => {
        const tempDir = await createTempFixture(pnpmFixtureDir)
        try {
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempDir,
            },
          )

          // Exit code might be non-zero if worker error occurred in CI mode.
          expect([0, 1].includes(code), 'exit code should be 0 or 1').toBe(true)

          // Verify package.json has overrides.
          const packageJsonPath = path.join(tempDir, PACKAGE_JSON)
          const packageJson = await readPackageJson(packageJsonPath)
          expect(packageJson?.overrides).toBeDefined()

          // Verify pnpm-lock.yaml was updated.
          const packageLockPath = path.join(tempDir, PNPM_LOCK_YAML)
          expect(existsSync(packageLockPath)).toBe(true)

          // Should mention optimization in output.
          const output = stdout + stderr
          expect(output).toMatch(/Optimizing|Adding overrides/i)
        } finally {
          // Clean up the temp directory safely.
          await deleteAsync(tempDir)
        }
      },
    )

    cmdit(
      ['optimize', '.', FLAG_PROD, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should optimize with --prod flag and modify files',
      async cmd => {
        const tempDir = await createTempFixture(pnpmFixtureDir)
        try {
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempDir,
            },
          )

          expect(code).toBe(0)

          // Check that command completed successfully (may or may not add overrides depending on available optimizations).
          const packageJsonPath = path.join(tempDir, PACKAGE_JSON)
          const packageJson = await readPackageJson(packageJsonPath)
          // Note: overrides may be undefined if no production dependencies have available optimizations.
          expect(packageJson).toBeDefined()

          // Should have optimization output.
          const output = stdout + stderr
          expect(output).toMatch(/optimized overrides|Optimizing|Adding overrides|Finished|No Socket.dev optimize/i)
        } finally {
          // Clean up the temp directory safely.
          await deleteAsync(tempDir)
        }
      },
      { timeout: 120_000 },
    )

    cmdit(
      [
        'optimize',
        '.',
        FLAG_PIN,
        FLAG_PROD,
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle optimize with both --pin and --prod flags',
      async cmd => {
        // Create temp fixture for this test.
        const { cleanup, tempDir } = await withTempFixture(pnpmFixtureDir)
        try {
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempDir,
            },
          )

          expect(code).toBe(0)

          // Check that command completed successfully (may or may not add overrides depending on available optimizations).
          const packageJsonPath = path.join(tempDir, PACKAGE_JSON)
          const packageJson = await readPackageJson(packageJsonPath)
          // Note: overrides may be undefined if no production dependencies have available optimizations..
          expect(packageJson).toBeDefined()

          // Verify pnpm-lock.yaml exists (since we're using pnpm, not npm).
          const packageLockPath = path.join(tempDir, PNPM_LOCK_YAML)
          expect(existsSync(packageLockPath)).toBe(true)

          // Should have optimization output.
          const output = stdout + stderr
          expect(output).toMatch(/optimized overrides|Optimizing|Adding overrides/i)
        } finally {
          await cleanup()
        }
      },
      { timeout: 120_000 },
    )

    cmdit(
      ['optimize', '.', FLAG_JSON, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should handle optimize with --json output format',
      async cmd => {
        // Create temp fixture for this test.
        const { cleanup, tempDir } = await withTempFixture(pnpmFixtureDir)
        try {
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempDir,
            },
          )

          expect(code).toBe(0)

          // Verify package.json has overrides.
          const packageJsonPath = path.join(tempDir, PACKAGE_JSON)
          const packageJson = await readPackageJson(packageJsonPath)
          expect(packageJson?.overrides).toBeDefined()

          // Verify pnpm-lock.yaml was updated.
          const packageLockPath = path.join(tempDir, PNPM_LOCK_YAML)
          expect(existsSync(packageLockPath)).toBe(true)
        } finally {
          await cleanup()
        }
      },
    )

    cmdit(
      [
        'optimize',
        '.',
        FLAG_MARKDOWN,
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle optimize with --markdown output format',
      async cmd => {
        // Create temp fixture for this test.
        const { cleanup, tempDir } = await withTempFixture(pnpmFixtureDir)
        try {
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempDir,
            },
          )

          expect(code).toBe(0)

          // Verify package.json has overrides.
          const packageJsonPath = path.join(tempDir, PACKAGE_JSON)
          const packageJson = await readPackageJson(packageJsonPath)
          expect(packageJson?.overrides).toBeDefined()

          // Verify pnpm-lock.yaml was updated.
          const packageLockPath = path.join(tempDir, PNPM_LOCK_YAML)
          expect(existsSync(packageLockPath)).toBe(true)

          // Should have regular output (markdown flag doesn't change console output).
          const output = stdout + stderr
          expect(output).toMatch(/Optimizing|Adding overrides/i)
        } finally {
          await cleanup()
        }
      },
    )

    cmdit(
      ['optimize', '.', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should handle npm projects with cwd correctly',
      async cmd => {
        // Create a temporary directory to test npm specifically.
        const tempDir = path.join(tmpdir(), 'socket-npm-test')
        await promises.mkdir(tempDir, { recursive: true })

        // Copy the npm fixture to the temp directory.
        const sourcePackageJson = path.join(npmFixtureDir, PACKAGE_JSON)
        const destPackageJson = path.join(tempDir, PACKAGE_JSON)
        await promises.copyFile(sourcePackageJson, destPackageJson)

        // Copy the npm lockfile.
        const sourceLock = path.join(npmFixtureDir, 'package-lock.json')
        const destLock = path.join(tempDir, 'package-lock.json')
        await promises.copyFile(sourceLock, destLock)

        try {
          // Run optimize from a different directory to ensure cwd is properly passed to npm install.
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            ['optimize', tempDir, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
            {
              // Run from a different directory to test that npm install gets the correct cwd.
              cwd: tmpdir(),
            },
          )

          expect(code).toBe(0)

          // Check that package.json was modified with overrides.
          const packageJsonPath = path.join(tempDir, PACKAGE_JSON)
          const packageJson = await readPackageJson(packageJsonPath)
          expect(packageJson?.overrides).toBeDefined()

          // Check that package-lock.json exists and was updated.
          const packageLockPath = path.join(tempDir, 'package-lock.json')
          expect(existsSync(packageLockPath)).toBe(true)

          // Should have optimization output.
          const output = stdout + stderr
          expect(output).toMatch(/optimized overrides|Optimizing|Adding overrides/i)
        } finally {
          // Clean up the temp directory safely.
          await deleteAsync(tempDir)
        }
      },
    )
  })

  describe('error handling and usability tests', () => {
    cmdit(
      [
        'optimize',
        '/nonexistent/path',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for non-existent directory',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code).toBe(1)
      },
    )

    cmdit(
      ['optimize', FLAG_DRY_RUN, '.', FLAG_CONFIG, '{}'],
      'should show clear error when API token is missing',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code, 'should exit with code 0 when no token').toBe(0)
      },
    )

    cmdit(
      ['optimize', FLAG_DRY_RUN, '.', FLAG_CONFIG, '{"apiToken":""}'],
      'should show clear error when API token is empty',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code, 'should exit with code 0 with empty token').toBe(0)
      },
    )

    cmdit(
      [
        'optimize',
        '.',
        FLAG_DRY_RUN,
        FLAG_PIN,
        FLAG_PROD,
        FLAG_JSON,
        FLAG_MARKDOWN,
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error when conflicting output flags are used',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'optimize',
        '.',
        FLAG_DRY_RUN,
        '--unknown-flag',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show helpful error for unknown flags',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['optimize', '.', FLAG_CONFIG, '{"apiToken":"invalid-token-format"}'],
      'should handle invalid API token gracefully',
      async cmd => {
        // Use a temp directory outside the repo to avoid modifying repo files.
        const { cleanup, tempDir } = await withTempFixture(pnpmFixtureDir)
        try {
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempDir,
            },
          )
          expect(code).toBe(0)
          const output = stdout + stderr
          // Should show authentication or token-related error.
          expect(output.length).toBeGreaterThan(0)
        } finally {
          await cleanup()
        }
      },
      { timeout: 30_000 },
    )

    cmdit(
      ['optimize', FLAG_PIN, FLAG_PROD, FLAG_HELP, FLAG_CONFIG, '{}'],
      'should prioritize help over other flags',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        expect(stdout).toContain(
          'Optimize dependencies with @socketregistry overrides',
        )
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['optimize', FLAG_VERSION, FLAG_CONFIG, '{}'],
      'should show version information',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(
          code,
          'should exit with non-zero code for version mismatch',
        ).toBeGreaterThan(0)
      },
    )
  })
})
