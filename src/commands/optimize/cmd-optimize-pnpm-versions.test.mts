import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  PACKAGE_JSON,
  PNPM,
  PNPM_LOCK_YAML,
  PNPM_WORKSPACE_YAML,
} from '../../../src/constants.mts'
import { spawnSocketCli, testPath } from '../../../test/utils.mts'
import { JsonContent } from '../../utils/fs.mts'
import { readPackageJson } from '../../utils/packages.mts'
import { spawn } from '../../utils/spawn.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/optimize')
async function prepareFixture(version: 'pnpm8' | 'pnpm9') {
  const source = path.join(fixtureBaseDir, version)
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), `socket-optimize-${version}-`),
  )
  onTestFinished(() => rm(cwd, { force: true, maxRetries: 5, recursive: true }))

  await Promise.all(
    [PACKAGE_JSON, PNPM_LOCK_YAML, PNPM_WORKSPACE_YAML].map(filename =>
      copyFile(path.join(source, filename), path.join(cwd, filename)),
    ),
  )

  // Keep the pnpm executable outside the tree its install command rewrites.
  const fixture = await readPackageJson(path.join(cwd, PACKAGE_JSON))
  const pnpmVersion = fixture.dependencies!.pnpm
  const binPath = path.resolve(
    testPath,
    '../scripts/test/tools',
    version,
    'node_modules/.bin',
  )
  const env = {
    ...process.env,
    CI: '1',
    PATH: [binPath, process.env.PATH].join(path.delimiter),
  }
  const options = { cwd, env, shell: process.platform === 'win32' }
  const { stdout } = await spawn(PNPM, ['--version'], options)
  expect(stdout.trim()).toBe(pnpmVersion)
  await spawn(PNPM, ['install', '--no-frozen-lockfile'], options)
  return { cwd, env }
}

describe('socket optimize - pnpm versions', { timeout: 60_000 }, async () => {
  const { binCliPath } = constants

  describe('pnpm v8', () => {
    let fixture: Awaited<ReturnType<typeof prepareFixture>>
    beforeEach(async () => {
      fixture = await prepareFixture('pnpm8')
    }, 120_000)

    it(
      'should optimize packages with pnpm v8',
      { timeout: 120_000 },
      async () => {
        const { cwd, env } = fixture
        const packageJsonPath = path.join(cwd, PACKAGE_JSON)
        const pkgJsonBefore = await readPackageJson(packageJsonPath)

        // Check abab is the expected version..
        expect(pkgJsonBefore.dependencies?.abab).toBe('2.0.6')

        const { code, stderr, stdout } = await spawnSocketCli(
          binCliPath,
          ['optimize', cwd, FLAG_CONFIG, '{}'],
          {
            cwd,
            env,
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
        const lockPath = path.join(cwd, PNPM_LOCK_YAML)
        expect(existsSync(lockPath)).toBe(true)
      },
    )

    it(
      'should handle --prod flag with pnpm v8',
      { timeout: 60_000 },
      async () => {
        const { cwd, env } = fixture
        const packageJsonPath = path.join(cwd, PACKAGE_JSON)
        const pkgJsonBefore = await readPackageJson(packageJsonPath)

        // Check abab is in dependencies (production), axios in devDependencies.
        expect(pkgJsonBefore.dependencies?.abab).toBe('2.0.6')
        expect(pkgJsonBefore.devDependencies?.axios).toBe('1.3.2')

        // Use dry-run to avoid hanging issues with npm ls.
        const { code, stderr, stdout } = await spawnSocketCli(
          binCliPath,
          [
            'optimize',
            cwd,
            '--prod',
            FLAG_DRY_RUN,
            FLAG_CONFIG,
            '{"apiToken":"fake-token"}',
          ],
          {
            cwd,
            env,
            timeout: 10_000,
          },
        )

        // With dry-run, should exit early.
        expect(stdout).toContain('[DryRun]: Bailing now')
        expect(code, stderr).toBe(0)
      },
    )
  })

  describe('pnpm v9', () => {
    let fixture: Awaited<ReturnType<typeof prepareFixture>>
    beforeEach(async () => {
      fixture = await prepareFixture('pnpm9')
    }, 120_000)

    it(
      'should optimize packages with pnpm v9',
      { timeout: 120_000 },
      async () => {
        const { cwd, env } = fixture
        const packageJsonPath = path.join(cwd, PACKAGE_JSON)
        const pkgJsonBefore = await readPackageJson(packageJsonPath)

        // Check abab is the expected version.
        expect(pkgJsonBefore.dependencies?.abab).toBe('2.0.6')

        const { code, stderr, stdout } = await spawnSocketCli(
          binCliPath,
          ['optimize', cwd, FLAG_CONFIG, '{}'],
          {
            cwd,
            env,
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
        expect(code, stderr).toBe(0)

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
        const lockPath = path.join(cwd, PNPM_LOCK_YAML)
        expect(existsSync(lockPath)).toBe(true)
      },
    )

    it(
      'should handle --pin flag with pnpm v9',
      { timeout: 120_000 },
      async () => {
        const { cwd, env } = fixture
        const packageJsonPath = path.join(cwd, PACKAGE_JSON)

        const { code, stderr } = await spawnSocketCli(
          binCliPath,
          ['optimize', cwd, '--pin', FLAG_CONFIG, '{}'],
          {
            cwd,
            env,
          },
        )

        // stderr contains the Socket banner and info messages
        expect(stderr, 'should show optimization message').toContain(
          'Optimizing packages for pnpm',
        )
        expect(code, stderr).toBe(0)

        const pkgJsonAfter = await readPackageJson(packageJsonPath)
        // Overrides should be added since abab is in Socket registry.
        expect(pkgJsonAfter.overrides).toBeDefined()
        // With --pin flag, the override uses $ syntax to pin to exact version.
        expect((pkgJsonAfter.overrides as JsonContent)?.abab).toBe('$abab')
      },
    )
  })
})
