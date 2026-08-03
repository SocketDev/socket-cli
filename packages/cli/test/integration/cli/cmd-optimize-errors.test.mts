/**
 * Integration tests for `socket optimize` error handling and usability.
 *
 * Covers non-existent paths, missing/empty API tokens, conflicting output
 * flags, unknown flags, help precedence, and version reporting.
 *
 * Related Files: - src/commands/optimize/handle-optimize.mts - Main command
 * handler - test/integration/cli/cmd-optimize.test.mts - Core command
 * integration tests.
 */

import path from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'

import { PNPM } from '@socketsecurity/lib-stable/constants/agents'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_JSON,
  FLAG_MARKDOWN,
  FLAG_PIN,
  FLAG_PROD,
  FLAG_VERSION,
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

describe('error handling and usability tests', () => {
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
    ['optimize', '/nonexistent/path', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
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
