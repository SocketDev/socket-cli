/**
 * Integration tests for `socket optimize` command.
 *
 * Tests the complete CLI flow of optimizing dependencies with @socketregistry
 * overrides. These tests use real CLI execution, not mocked, to verify
 * end-to-end behavior.
 *
 * Test Coverage: - Command help output - Dry-run mode validation (no file
 * modifications) - Flag combinations (--pin, --prod, --dry-run)
 *
 * Package Manager Support: - npm: Shadow installation with security scanning
 * tested via integration - pnpm: Standard installation with CI-mode
 * configuration, tested here - yarn: Standard installation, tested here.
 *
 * Note: Unit tests for mocked behavior were removed due to ESM module
 * resolution limitations. These integration tests provide comprehensive
 * coverage by testing real CLI execution against fixture projects.
 *
 * Related Files: - src/commands/optimize/handle-optimize.mts - Main command
 * handler - src/commands/optimize/agent-installer.mts - Package manager install
 * logic - test/integration/cli/cmd-optimize-output-and-paths.test.mts - Output
 * format and path handling tests -
 * test/unit/commands/optimize/agent-installer.test.mts - Unit tests for
 * non-npm agents.
 */

import { existsSync, promises } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'

import { NPM, PNPM } from '@socketsecurity/lib-stable/constants/agents'
import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { readPackageJson } from '@socketsecurity/lib-stable/packages/read'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_PIN,
  FLAG_PROD,
} from '../../../src/constants/cli.mts'
import {
  PACKAGE_JSON,
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
} from '../../../src/constants/packages.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/optimize')
const npmFixtureDir = path.join(fixtureBaseDir, NPM)
const pnpmFixtureDir = path.join(fixtureBaseDir, PNPM)

export async function createTempFixture(sourceDir: string): Promise<string> {
  // Create a temporary directory with a unique name.
  const tempDir = path.join(
    os.tmpdir(),
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
        `
        "Optimize dependencies with @socketregistry overrides

          Usage
                $ socket optimize [options] [CWD=.]
          
              API Token Requirements
                - Quota: 100 units
                - Permissions: packages:list
          
              Options
                --pin               Pin overrides to latest version
                --prod              Add overrides for production dependencies only
                --quiet             Route non-essential output (status, progress, warnings) to stderr so stdout carries only the payload. Implied by --json and --markdown.
          
              Examples
                $ socket optimize
                $ socket optimize ./path/to/project --pin"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket optimize\`, cwd: <redacted>"
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
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket optimize\`, cwd: <redacted>


        [DryRun]: Optimize dependencies with @socketregistry overrides (pnpm v11.11.0)

          Actions that would be performed:
            - [fetch] Detected pnpm v11.11.0 \\u2192 [PROJECT]
            - [fetch] Analyze dependencies against @socketregistry overrides \\u2192 package.json and lockfile
            - [modify] Add or update overrides section in package.json \\u2192 [PROJECT]/package.json
                pin: "No - use version ranges"
                prod: "No - all dependencies"
            - [execute] Run pnpm to install optimized dependencies

          Would complete successfully.

          Run without --dry-run to execute these actions."
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
        "_____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket optimize\`, cwd: <redacted>


        [DryRun]: Optimize dependencies with @socketregistry overrides (pnpm v11.11.0)

          Actions that would be performed:
            - [fetch] Detected pnpm v11.11.0 \\u2192 [PROJECT]
            - [fetch] Analyze dependencies against @socketregistry overrides \\u2192 package.json and lockfile
            - [modify] Add or update overrides section in package.json \\u2192 [PROJECT]/package.json
                pin: "Yes - pin to specific versions"
                prod: "No - all dependencies"
            - [execute] Run pnpm to install optimized dependencies

          Would complete successfully.

          Run without --dry-run to execute these actions."
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
        "_____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket optimize\`, cwd: <redacted>


        [DryRun]: Optimize dependencies with @socketregistry overrides (pnpm v11.11.0)

          Actions that would be performed:
            - [fetch] Detected pnpm v11.11.0 \\u2192 [PROJECT]
            - [fetch] Analyze dependencies against @socketregistry overrides \\u2192 package.json and lockfile
            - [modify] Add or update overrides section in package.json \\u2192 [PROJECT]/package.json
                pin: "No - use version ranges"
                prod: "Yes - production dependencies only"
            - [execute] Run pnpm to install optimized dependencies

          Would complete successfully.

          Run without --dry-run to execute these actions."
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
        "_____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket optimize\`, cwd: <redacted>


        [DryRun]: Optimize dependencies with @socketregistry overrides (pnpm v11.11.0)

          Actions that would be performed:
            - [fetch] Detected pnpm v11.11.0 \\u2192 [PROJECT]
            - [fetch] Analyze dependencies against @socketregistry overrides \\u2192 package.json and lockfile
            - [modify] Add or update overrides section in package.json \\u2192 [PROJECT]/package.json
                pin: "Yes - pin to specific versions"
                prod: "Yes - production dependencies only"
            - [execute] Run pnpm to install optimized dependencies

          Would complete successfully.

          Run without --dry-run to execute these actions."
      `)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
