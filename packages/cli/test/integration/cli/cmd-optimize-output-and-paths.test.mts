/**
 * Integration tests for `socket optimize` output formats and path handling.
 *
 * Covers --json and --markdown output formats, custom directory paths,
 * directories without package.json, comprehensive flag combinations, and the
 * basic project fixture.
 *
 * Related Files: - src/commands/optimize/handle-optimize.mts - Main command
 * handler - test/integration/cli/cmd-optimize.test.mts - Core command
 * integration tests.
 */

import path from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'

import { PNPM } from '@socketsecurity/lib-stable/constants/agents'
import { readPackageJson } from '@socketsecurity/lib-stable/packages/read'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_JSON,
  FLAG_MARKDOWN,
  FLAG_PIN,
  FLAG_PROD,
} from '../../../src/constants/cli.mts'
import {
  PACKAGE_JSON,
  PNPM_LOCK_YAML,
} from '../../../src/constants/packages.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/optimize')
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

describe('socket optimize output formats and paths', () => {
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
        "[DryRun]: Optimize dependencies with @socketregistry overrides (pnpm v11.11.0)

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
        "[DryRun]: Optimize dependencies with @socketregistry overrides (pnpm v11.11.0)

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
        "_____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket optimize\`, cwd: <redacted>


        [DryRun]: Optimize dependencies with @socketregistry overrides

          Actions that would be performed:
            - [fetch] Detect package environment \\u2192 [PROJECT]/custom-path

          Would fail (see details above).

          Run without --dry-run to execute these actions."
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
        "[DryRun]: Optimize dependencies with @socketregistry overrides (pnpm v11.11.0)

          Actions that would be performed:
            - [fetch] Detected pnpm v11.11.0 \\u2192 [PROJECT]/packages/cli/test/fixtures/commands/optimize/pnpm
            - [fetch] Analyze dependencies against @socketregistry overrides \\u2192 package.json and lockfile
            - [modify] Add or update overrides section in package.json \\u2192 [PROJECT]/packages/cli/test/fixtures/commands/optimize/pnpm/package.json
                pin: "Yes - pin to specific versions"
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
        "[DryRun]: Optimize dependencies with @socketregistry overrides (pnpm v11.11.0)

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
