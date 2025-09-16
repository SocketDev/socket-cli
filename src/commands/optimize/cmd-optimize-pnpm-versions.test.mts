import path from 'node:path'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { existsSync, promises as fs } from 'node:fs'
import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { spawnSync } from '@socketsecurity/registry/lib/spawn'

import constants, { PNPM_LOCK_YAML } from '../../../src/constants.mts'
import { spawnSocketCli, testPath } from '../../../test/utils.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/optimize')
const pnpm8FixtureDir = path.join(fixtureBaseDir, 'pnpm8')
const pnpm9FixtureDir = path.join(fixtureBaseDir, 'pnpm9')

async function revertFixtureChanges(fixtureDir: string, packageJsonContent: string) {
  // Reset the package.json to original state.
  const packageJsonPath = path.join(fixtureDir, 'package.json')
  await fs.writeFile(packageJsonPath, packageJsonContent)
}

describe('socket optimize - pnpm versions', { timeout: 60_000 }, async () => {
  const { binCliPath } = constants

  const pnpm8PackageJson = `{
  "name": "optimize-test-pnpm8",
  "version": "1.0.0",
  "description": "Test fixture for optimize command with pnpm v8",
  "main": "index.js",
  "dependencies": {
    "lodash": "4.17.20",
    "pnpm": "^8.15.9"
  },
  "devDependencies": {
    "axios": "1.3.2"
  }
}`

  const pnpm9PackageJson = `{
  "name": "optimize-test-pnpm9",
  "version": "1.0.0",
  "description": "Test fixture for optimize command with pnpm v9",
  "main": "index.js",
  "dependencies": {
    "lodash": "4.17.20",
    "pnpm": "^9.14.4"
  },
  "devDependencies": {
    "axios": "1.3.2"
  }
}`

  describe('pnpm v8', () => {
    const pnpm8BinPath = path.join(pnpm8FixtureDir, 'node_modules/.bin')

    beforeAll(async () => {
      // Ensure fixtures are in clean state before tests.
      await revertFixtureChanges(pnpm8FixtureDir, pnpm8PackageJson)
      // First install pnpm v8 with npm
      spawnSync('npm', ['install', '--silent', '--no-save', 'pnpm@^8.15.9'], {
        cwd: pnpm8FixtureDir,
        stdio: 'ignore',
      })
      // Then use pnpm to install dependencies
      const pnpmBin = path.join(pnpm8FixtureDir, 'node_modules/.bin/pnpm')
      spawnSync(pnpmBin, ['install', '--silent'], {
        cwd: pnpm8FixtureDir,
        stdio: 'ignore',
      })
      // Remove any package-lock.json created by npm
      const lockPath = path.join(pnpm8FixtureDir, 'package-lock.json')
      try {
        await fs.unlink(lockPath)
      } catch {
        // Ignore if it doesn't exist
      }
    })

    afterEach(async () => {
      // Revert all changes after each test.
      await revertFixtureChanges(pnpm8FixtureDir, pnpm8PackageJson)
    })

    afterAll(async () => {
      // Clean up once after all tests.
      await revertFixtureChanges(pnpm8FixtureDir, pnpm8PackageJson)
    })

    it('should optimize packages with pnpm v8', { timeout: 30_000 }, async () => {
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
        ['optimize', pnpm8FixtureDir, '--config', '{}'],
        {
          cwd: pnpm8FixtureDir,
          env: {
            ...process.env,
            PATH: `${pnpm8BinPath}:${process.env.PATH}`,
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
    })

    it('should handle --prod flag with pnpm v8', { timeout: 30_000 }, async () => {
      const packageJsonPath = path.join(pnpm8FixtureDir, 'package.json')

      const { code, stderr, stdout } = await spawnSocketCli(
        binCliPath,
        ['optimize', pnpm8FixtureDir, '--prod', '--config', '{}'],
        {
          cwd: pnpm8FixtureDir,
          env: {
            ...process.env,
            PATH: `${pnpm8BinPath}:${process.env.PATH}`,
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
    })
  })

  describe('pnpm v9', () => {
    const pnpm9BinPath = path.join(pnpm9FixtureDir, 'node_modules/.bin')

    beforeAll(async () => {
      // Ensure fixtures are in clean state before tests.
      await revertFixtureChanges(pnpm9FixtureDir, pnpm9PackageJson)
      // First install pnpm v9 with npm
      spawnSync('npm', ['install', '--silent', '--no-save', 'pnpm@^9.14.4'], {
        cwd: pnpm9FixtureDir,
        stdio: 'ignore',
      })
      // Then use pnpm to install dependencies
      const pnpmBin = path.join(pnpm9FixtureDir, 'node_modules/.bin/pnpm')
      spawnSync(pnpmBin, ['install', '--silent'], {
        cwd: pnpm9FixtureDir,
        stdio: 'ignore',
      })
      // Remove any package-lock.json created by npm
      const lockPath = path.join(pnpm9FixtureDir, 'package-lock.json')
      try {
        await fs.unlink(lockPath)
      } catch {
        // Ignore if it doesn't exist
      }
    })

    afterEach(async () => {
      // Revert all changes after each test.
      await revertFixtureChanges(pnpm9FixtureDir, pnpm9PackageJson)
    })

    afterAll(async () => {
      // Clean up once after all tests.
      await revertFixtureChanges(pnpm9FixtureDir, pnpm9PackageJson)
    })

    it('should optimize packages with pnpm v9', { timeout: 30_000 }, async () => {
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
        ['optimize', pnpm9FixtureDir, '--config', '{}'],
        {
          cwd: pnpm9FixtureDir,
          env: {
            ...process.env,
            PATH: `${pnpm9BinPath}:${process.env.PATH}`,
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
    })

    it('should handle --pin flag with pnpm v9', { timeout: 30_000 }, async () => {
      const packageJsonPath = path.join(pnpm9FixtureDir, 'package.json')

      const { code, stderr, stdout } = await spawnSocketCli(
        binCliPath,
        ['optimize', pnpm9FixtureDir, '--pin', '--config', '{}'],
        {
          cwd: pnpm9FixtureDir,
          env: {
            ...process.env,
            PATH: `${pnpm9BinPath}:${process.env.PATH}`,
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
    })
  })
})