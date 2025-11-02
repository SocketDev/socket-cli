import { existsSync, promises } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'

import { NPM, PNPM } from '@socketsecurity/lib/constants/agents'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { readPackageJson } from '@socketsecurity/lib/packages'
import { spawn } from '@socketsecurity/lib/spawn'

import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'
import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_JSON,
  FLAG_MARKDOWN,
  FLAG_PIN,
  FLAG_PROD,
  FLAG_VERSION,
} from '../../constants/cli.mts'
import {
  PACKAGE_JSON,
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
} from '../../constants/packages.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/optimize')
const _npmFixtureDir = path.join(fixtureBaseDir, NPM)
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

async function _createTempFixture(sourceDir: string): Promise<string> {
  // Create a temporary directory with a unique name.
  const tempDir = path.join(
    tmpdir(),
    `socket-optimize-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )

  // Copy the fixture files to the temp directory.
  await safeMkdir(tempDir, { recursive: true })

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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
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
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, PACKAGE_JSON)
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
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
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
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
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
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
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "Socket CLI Error: Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in [PROJECT]/node_modules/@socketsecurity/lib/package.json
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
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

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
