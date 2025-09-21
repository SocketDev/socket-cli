import { existsSync } from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { spawnSync } from '@socketsecurity/registry/lib/spawn'

import constants, {
  FLAG_CONFIG,
  FLAG_SILENT,
  PNPM_LOCK_YAML,
} from '../../../src/constants.mts'
import { spawnSocketCli, testPath } from '../../../test/utils.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/optimize')
const pnpm8FixtureDir = path.join(fixtureBaseDir, 'pnpm8')
const pnpm9FixtureDir = path.join(fixtureBaseDir, 'pnpm9')

// TODO: These tests need proper pnpm version setup in fixtures.
describe.skip(
  'socket optimize - pnpm versions',
  { timeout: 60_000 },
  async () => {
    const { binCliPath } = constants

    describe('pnpm v8', () => {
      const pnpm8BinPath = path.join(pnpm8FixtureDir, 'node_modules/.bin')

      beforeEach(async () => {
        // Ensure pnpm v8 is installed in the fixture
        spawnSync('npm', ['install', FLAG_SILENT], {
          cwd: pnpm8FixtureDir,
          stdio: 'ignore',
        })
        // Clean up any modifications from previous runs
        spawnSync('git', ['restore', '.'], {
          cwd: pnpm8FixtureDir,
          stdio: 'ignore',
        })
      })

      afterEach(async () => {
        // Restore fixture to original state
        spawnSync('git', ['restore', '.'], {
          cwd: pnpm8FixtureDir,
          stdio: 'ignore',
        })
      })

      it(
        'should optimize packages with pnpm v8',
        { timeout: 30_000 },
        async () => {
          // Ensure npm install completed for pnpm v8
          const pnpmBin = path.join(pnpm8BinPath, 'pnpm')
          const pnpmVersion = spawnSync(pnpmBin, ['--version'], {
            encoding: 'utf8',
          })
          expect(pnpmVersion.stdout?.trim()).toMatch(/^8\.\d+\.\d+$/)

          const packageJsonPath = path.join(pnpm8FixtureDir, 'package.json')
          const pkgJsonBefore = await readPackageJson(packageJsonPath)

          // Check lodash is vulnerable version (easter egg!)
          expect(pkgJsonBefore.dependencies?.lodash).toBe('4.17.20')

          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            ['optimize', pnpm8FixtureDir, FLAG_CONFIG, '{}'],
            {
              cwd: pnpm8FixtureDir,
              env: {
                ...process.env,
                PATH: `${pnpm8BinPath}:${constants.ENV.PATH || process.env.PATH}`,
              },
            },
          )

          // stderr contains the Socket banner and info messages
          expect(stderr, 'should show optimization message').toContain(
            'Optimizing packages for pnpm',
          )
          expect(stdout, 'should show success message').toMatch(
            /Socket\.dev optimized overrides/,
          )
          expect(code, 'exit code should be 0').toBe(0)

          const pkgJsonAfter = await readPackageJson(packageJsonPath)
          // Should have overrides added
          expect(pkgJsonAfter.overrides).toBeDefined()
          expect(pkgJsonAfter.resolutions).toBeDefined()

          // Check that pnpm-lock.yaml exists and was modified
          const lockPath = path.join(pnpm8FixtureDir, PNPM_LOCK_YAML)
          expect(existsSync(lockPath)).toBe(true)
        },
      )

      it(
        'should handle --prod flag with pnpm v8',
        { timeout: 30_000 },
        async () => {
          const packageJsonPath = path.join(pnpm8FixtureDir, 'package.json')

          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            ['optimize', pnpm8FixtureDir, '--prod', FLAG_CONFIG, '{}'],
            {
              cwd: pnpm8FixtureDir,
              env: {
                ...process.env,
                PATH: `${pnpm8BinPath}:${constants.ENV.PATH || process.env.PATH}`,
              },
            },
          )

          // stderr contains the Socket banner and info messages
          expect(stderr, 'should show optimization message').toContain(
            'Optimizing packages for pnpm',
          )
          expect(code, 'exit code should be 0').toBe(0)

          const pkgJsonAfter = await readPackageJson(packageJsonPath)
          // Should have overrides for production deps only
          expect(pkgJsonAfter.overrides).toBeDefined()
        },
      )
    })

    describe('pnpm v9', () => {
      const pnpm9BinPath = path.join(pnpm9FixtureDir, 'node_modules/.bin')

      beforeEach(async () => {
        // Ensure pnpm v9 is installed in the fixture
        spawnSync('npm', ['install', FLAG_SILENT], {
          cwd: pnpm9FixtureDir,
          stdio: 'ignore',
        })
        // Clean up any modifications from previous runs
        spawnSync('git', ['restore', '.'], {
          cwd: pnpm9FixtureDir,
          stdio: 'ignore',
        })
      })

      afterEach(async () => {
        // Restore fixture to original state
        spawnSync('git', ['restore', '.'], {
          cwd: pnpm9FixtureDir,
          stdio: 'ignore',
        })
      })

      it(
        'should optimize packages with pnpm v9',
        { timeout: 30_000 },
        async () => {
          // Ensure npm install completed for pnpm v9
          const pnpmBin = path.join(pnpm9BinPath, 'pnpm')
          const pnpmVersion = spawnSync(pnpmBin, ['--version'], {
            encoding: 'utf8',
          })
          expect(pnpmVersion.stdout?.trim()).toMatch(/^9\.\d+\.\d+$/)

          const packageJsonPath = path.join(pnpm9FixtureDir, 'package.json')
          const pkgJsonBefore = await readPackageJson(packageJsonPath)

          // Check lodash is vulnerable version (easter egg!)
          expect(pkgJsonBefore.dependencies?.lodash).toBe('4.17.20')

          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            ['optimize', pnpm9FixtureDir, FLAG_CONFIG, '{}'],
            {
              cwd: pnpm9FixtureDir,
              env: {
                ...process.env,
                PATH: `${pnpm9BinPath}:${constants.ENV.PATH || process.env.PATH}`,
              },
            },
          )

          // stderr contains the Socket banner and info messages
          expect(stderr, 'should show optimization message').toContain(
            'Optimizing packages for pnpm',
          )
          expect(stdout, 'should show success message').toMatch(
            /Socket\.dev optimized overrides/,
          )
          expect(code, 'exit code should be 0').toBe(0)

          const pkgJsonAfter = await readPackageJson(packageJsonPath)
          // Should have overrides added
          expect(pkgJsonAfter.overrides).toBeDefined()
          expect(pkgJsonAfter.resolutions).toBeDefined()

          // Check that pnpm-lock.yaml exists and was modified
          const lockPath = path.join(pnpm9FixtureDir, PNPM_LOCK_YAML)
          expect(existsSync(lockPath)).toBe(true)
        },
      )

      it(
        'should handle --pin flag with pnpm v9',
        { timeout: 30_000 },
        async () => {
          const packageJsonPath = path.join(pnpm9FixtureDir, 'package.json')

          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            ['optimize', pnpm9FixtureDir, '--pin', FLAG_CONFIG, '{}'],
            {
              cwd: pnpm9FixtureDir,
              env: {
                ...process.env,
                PATH: `${pnpm9BinPath}:${constants.ENV.PATH || process.env.PATH}`,
              },
            },
          )

          // stderr contains the Socket banner and info messages
          expect(stderr, 'should show optimization message').toContain(
            'Optimizing packages for pnpm',
          )
          expect(code, 'exit code should be 0').toBe(0)

          const pkgJsonAfter = await readPackageJson(packageJsonPath)
          // Should have overrides with pinned versions
          expect(pkgJsonAfter.overrides).toBeDefined()

          // Check that overrides use exact versions when pinned
          const overrideValues = Object.values(pkgJsonAfter.overrides || {})
          overrideValues.forEach(value => {
            if (typeof value === 'string' && !value.startsWith('$')) {
              // Should not have ^ or ~ when pinned
              expect(value).not.toMatch(/[\^~]/)
            }
          })
        },
      )
    })
  },
)
