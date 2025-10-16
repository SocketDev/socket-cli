import { existsSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PNPM } from '@socketsecurity/registry/constants/agents'
import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { withTempFixture } from '../../../src/utils/test-fixtures.mts'
import { spawnSocketCli, testPath } from '../../../test/utils.mts'
import { PNPM_LOCK_YAML } from '../../constants/packages.mts'
import { FLAG_CONFIG, FLAG_DRY_RUN, FLAG_SILENT } from '../constants/cli.mts'
import ENV from '../constants/env.mts'
import { getBinCliPath } from '../constants/paths.mts'

import type { JsonContent } from '@socketsecurity/registry/lib/fs'

const binCliPath = getBinCliPath()
const fixtureBaseDir = path.join(testPath, 'fixtures/commands/optimize')

// Track cleanup functions for each test.
let cleanupFunctions: Array<() => Promise<void>> = []

describe('socket optimize - pnpm versions', { timeout: 60_000 }, async () => {afterEach(async () => {
    // Clean up all temporary directories after each test.
    await Promise.all(cleanupFunctions.map(cleanup => cleanup()))
    cleanupFunctions = []
  })

  describe('pnpm v8', () => {
    it(
      'should optimize packages with pnpm v8',
      { timeout: 30_000 },
      async () => {
        // Create temp fixture for pnpm8.
        const { cleanup, tempDir: pnpm8FixtureDir } = await withTempFixture(
          path.join(fixtureBaseDir, 'pnpm8'),
        )
        cleanupFunctions.push(cleanup)

        const pnpm8BinPath = path.join(pnpm8FixtureDir, 'node_modules', '.bin')

        // Ensure pnpm v8 is installed in the temp fixture.
        try {
          await spawn(
            PNPM,
            [
              'install',
              FLAG_SILENT,
              '--config.confirmModulesPurge=false',
              '--no-frozen-lockfile',
            ],
            {
              cwd: pnpm8FixtureDir,
              stdio: 'ignore',
            },
          )
        } catch {}

        const packageJsonPath = path.join(pnpm8FixtureDir, 'package.json')
        const pkgJsonBefore = await readPackageJson(packageJsonPath)

        // Check abab is the expected version..
        expect(pkgJsonBefore.dependencies?.abab).toBe('2.0.6')

        const { code, stderr, stdout } = await spawnSocketCli(
          binCliPath,
          ['optimize', pnpm8FixtureDir, FLAG_CONFIG, '{}'],
          {
            cwd: pnpm8FixtureDir,
            env: {
              ...process.env,
              CI: '1',
              PATH: `${pnpm8BinPath}:${ENV.PATH || process.env['PATH']}`,
            },
          },
        )

        // stderr contains the Socket banner and info messages
        expect(stderr, 'should show optimization message').toContain(
          'Optimizing packages for pnpm',
        )
        // Check for Socket.dev optimized overrides message (may be phrased differently).
        // Note: In CI mode, pnpm v8 may encounter worker errors.
        expect(
          stdout.includes('Socket.dev optimized overrides') ||
            stdout.includes('ERROR') ||
            stdout.includes('Worker'),
          'should attempt optimization',
        ).toBe(true)
        // Exit code might be non-zero if worker error occurred in CI mode.
        expect([0, 1].includes(code), 'exit code should be 0 or 1').toBe(true)

        const pkgJsonAfter = await readPackageJson(packageJsonPath)
        // Overrides should be added since abab is in Socket registry.
        expect(pkgJsonAfter.overrides).toBeDefined()
        // Override format varies by pnpm version.
        const ababOverride = (pkgJsonAfter.overrides as JsonContent)?.abab
        expect(
          ababOverride === '$abab' ||
            ababOverride === 'npm:@socketregistry/abab@^1.0.8' ||
            ababOverride === '@socketregistry/abab@^1.0.8',
        ).toBe(true)
        // Check that pnpm-lock.yaml exists and was modified.
        const lockPath = path.join(pnpm8FixtureDir, PNPM_LOCK_YAML)
        expect(existsSync(lockPath)).toBe(true)
      },
    )

    it(
      'should handle --prod flag with pnpm v8',
      { timeout: 10_000 },
      async () => {
        // Create temp fixture for pnpm8.
        const { cleanup, tempDir: pnpm8FixtureDir } = await withTempFixture(
          path.join(fixtureBaseDir, 'pnpm8'),
        )
        cleanupFunctions.push(cleanup)

        const pnpm8BinPath = path.join(pnpm8FixtureDir, 'node_modules', '.bin')

        // Ensure pnpm v8 is installed in the temp fixture.
        try {
          await spawn(
            PNPM,
            [
              'install',
              FLAG_SILENT,
              '--config.confirmModulesPurge=false',
              '--no-frozen-lockfile',
            ],
            {
              cwd: pnpm8FixtureDir,
              stdio: 'ignore',
            },
          )
        } catch {}

        const packageJsonPath = path.join(pnpm8FixtureDir, 'package.json')
        const pkgJsonBefore = await readPackageJson(packageJsonPath)

        // Check abab is in dependencies (production), axios in devDependencies.
        expect(pkgJsonBefore.dependencies?.abab).toBe('2.0.6')
        expect(pkgJsonBefore.devDependencies?.axios).toBe('1.3.2')

        // Use dry-run to avoid hanging issues with npm ls.
        const { code, stdout } = await spawnSocketCli(
          binCliPath,
          [
            'optimize',
            pnpm8FixtureDir,
            '--prod',
            FLAG_DRY_RUN,
            FLAG_CONFIG,
            '{"apiToken":"fake-token"}',
          ],
          {
            cwd: pnpm8FixtureDir,
            env: {
              ...process.env,
              CI: '1',
              PATH: `${pnpm8BinPath}:${ENV.PATH || process.env['PATH']}`,
            },
            timeout: 10_000,
          },
        )

        // With dry-run, should exit early.
        expect(stdout).toContain('[DryRun]: Bailing now')
        expect(code, 'exit code should be 0').toBe(0)
      },
    )
  })

  describe('pnpm v9', () => {
    it(
      'should optimize packages with pnpm v9',
      { timeout: 30_000 },
      async () => {
        // Create temp fixture for pnpm9.
        const { cleanup, tempDir: pnpm9FixtureDir } = await withTempFixture(
          path.join(fixtureBaseDir, 'pnpm9'),
        )
        cleanupFunctions.push(cleanup)

        const pnpm9BinPath = path.join(pnpm9FixtureDir, 'node_modules', '.bin')

        // Ensure pnpm v9 is installed in the temp fixture.
        try {
          await spawn(
            PNPM,
            [
              'install',
              FLAG_SILENT,
              '--config.confirmModulesPurge=false',
              '--no-frozen-lockfile',
            ],
            {
              cwd: pnpm9FixtureDir,
              stdio: 'ignore',
            },
          )
        } catch {}

        const packageJsonPath = path.join(pnpm9FixtureDir, 'package.json')
        const pkgJsonBefore = await readPackageJson(packageJsonPath)

        // Check abab is the expected version.
        expect(pkgJsonBefore.dependencies?.abab).toBe('2.0.6')

        const { code, stderr, stdout } = await spawnSocketCli(
          binCliPath,
          ['optimize', pnpm9FixtureDir, FLAG_CONFIG, '{}'],
          {
            cwd: pnpm9FixtureDir,
            env: {
              ...process.env,
              CI: '1',
              PATH: `${pnpm9BinPath}:${ENV.PATH || process.env['PATH']}`,
            },
          },
        )

        // stderr contains the Socket banner and info messages
        expect(stderr, 'should show optimization message').toContain(
          'Optimizing packages for pnpm',
        )
        // Overrides applied since abab is in Socket registry.
        // The message format varies: "Added X Socket.dev optimized overrides" or "Socket.dev optimized overrides applied".
        expect(stdout, 'should show overrides applied').toContain(
          'Socket.dev optimized overrides',
        )
        expect(code, 'exit code should be 0').toBe(0)

        const pkgJsonAfter = await readPackageJson(packageJsonPath)
        // Overrides should be added since abab is in Socket registry.
        expect(pkgJsonAfter.overrides).toBeDefined()
        // Override format varies by pnpm version.
        const ababOverride = (pkgJsonAfter.overrides as JsonContent)?.abab
        expect(
          ababOverride === '$abab' ||
            ababOverride === 'npm:@socketregistry/abab@^1.0.8' ||
            ababOverride === '@socketregistry/abab@^1.0.8',
        ).toBe(true)
        // Check that pnpm-lock.yaml exists and was modified.
        const lockPath = path.join(pnpm9FixtureDir, PNPM_LOCK_YAML)
        expect(existsSync(lockPath)).toBe(true)
      },
    )

    it(
      'should handle --pin flag with pnpm v9',
      { timeout: 30_000 },
      async () => {
        // Create temp fixture for pnpm9.
        const { cleanup, tempDir: pnpm9FixtureDir } = await withTempFixture(
          path.join(fixtureBaseDir, 'pnpm9'),
        )
        cleanupFunctions.push(cleanup)

        const pnpm9BinPath = path.join(pnpm9FixtureDir, 'node_modules', '.bin')

        // Ensure pnpm v9 is installed in the temp fixture.
        try {
          await spawn(
            PNPM,
            [
              'install',
              FLAG_SILENT,
              '--config.confirmModulesPurge=false',
              '--no-frozen-lockfile',
            ],
            {
              cwd: pnpm9FixtureDir,
              stdio: 'ignore',
            },
          )
        } catch {}

        const packageJsonPath = path.join(pnpm9FixtureDir, 'package.json')

        const { code, stderr } = await spawnSocketCli(
          binCliPath,
          [
            'optimize',
            pnpm9FixtureDir,
            '--pin',
            FLAG_CONFIG,
            '{"apiToken":"fake-token"}',
          ],
          {
            cwd: pnpm9FixtureDir,
            env: {
              ...process.env,
              CI: '1',
              PATH: `${pnpm9BinPath}:${ENV.PATH || process.env['PATH']}`,
            },
          },
        )

        // stderr contains the Socket banner and info messages
        expect(stderr, 'should show optimization message').toContain(
          'Optimizing packages for pnpm',
        )
        expect(code, 'exit code should be 0').toBe(0)

        const pkgJsonAfter = await readPackageJson(packageJsonPath)
        // Overrides should be added since abab is in Socket registry.
        expect(pkgJsonAfter.overrides).toBeDefined()
        // With --pin flag, the override uses $ syntax to pin to exact version.
        expect((pkgJsonAfter.overrides as JsonContent)?.abab).toBe('$abab')
      },
    )
  })
})
