/**
 * @file Tests for the @socketsecurity/cli-with-sentry package template
 *   structure and configuration.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const configDir = path.join(packageDir, '.config')
const binDir = path.join(packageDir, 'bin')
const scriptsDir = path.join(packageDir, 'scripts')
// The template lives at packages/package-builder/templates/cli-sentry-package;
// the main CLI package is at packages/cli.
const cliSrcDir = path.join(packageDir, '../../../cli/src')

describe('@socketsecurity/cli-with-sentry package template', () => {
  describe('package.json validation', () => {
    it('should have valid package.json metadata', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.name).toBe('@socketsecurity/cli-with-sentry')
      // Allow prerelease tags.
      expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/)
      expect(pkgJson.license).toBe('MIT')
      expect(pkgJson.description).toContain('Sentry')
      expect(pkgJson.description).toContain('telemetry')
    })

    it('should have build script', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.scripts).toBeDefined()
      expect(pkgJson.scripts.build).toBe('node scripts/build.mts')
      expect(pkgJson.scripts['clean:dist']).toBeDefined()
    })

    it('should have all CLI bin entries', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.bin).toBeDefined()
      expect(pkgJson.bin.socket).toBe('bin/cli.js')
      expect(pkgJson.bin['socket-npm']).toBe('bin/npm-cli.js')
      expect(pkgJson.bin['socket-npx']).toBe('bin/npx-cli.js')
      expect(pkgJson.bin['socket-pnpm']).toBe('bin/pnpm-cli.js')
      expect(pkgJson.bin['socket-yarn']).toBe('bin/yarn-cli.js')
    })

    it('should have Sentry as a runtime dependency', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      // @sentry/node stays external to the bundle, so it must be a runtime
      // dependency of the published package (not a devDependency).
      expect(pkgJson.dependencies).toBeDefined()
      expect(pkgJson.dependencies['@sentry/node']).toBeDefined()
    })

    it('should build against the main CLI package', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      // The CLI source is bundled at build time, so the workspace link is a
      // devDependency rather than a runtime dependency.
      expect(pkgJson.devDependencies).toBeDefined()
      expect(pkgJson.devDependencies['@socketsecurity/cli']).toBe(
        'workspace:0.0.0',
      )
      expect(pkgJson.devDependencies.rolldown).toBeDefined()
    })
  })

  describe('bin wrappers exist', () => {
    it('should have bin directory', () => {
      expect(existsSync(binDir)).toBe(true)
    })

    for (const wrapper of [
      'cli.js',
      'npm-cli.js',
      'npx-cli.js',
      'pnpm-cli.js',
      'yarn-cli.js',
    ]) {
      it(`should have ${wrapper} wrapper`, () => {
        expect(existsSync(path.join(binDir, wrapper))).toBe(true)
      })
    }
  })

  describe('build configuration', () => {
    it('should have .config directory', () => {
      expect(existsSync(configDir)).toBe(true)
    })

    it('should have rolldown config', () => {
      const rolldownPath = path.join(configDir, 'rolldown.cli-sentry.build.mts')
      expect(existsSync(rolldownPath)).toBe(true)
    })
  })

  describe('build scripts exist', () => {
    it('should have scripts directory', () => {
      expect(existsSync(scriptsDir)).toBe(true)
    })

    it('should have build.mts script', () => {
      const buildPath = path.join(scriptsDir, 'build.mts')
      expect(existsSync(buildPath)).toBe(true)
    })
  })

  describe('README documentation', () => {
    it('should have README.md', () => {
      const readmePath = path.join(packageDir, 'README.md')
      expect(existsSync(readmePath)).toBe(true)
    })
  })

  describe('package is publishable', () => {
    it('should not be private: the declared publish set must be release-ready', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      // A `private: true` here makes npm skip the package while the release
      // stays green, so the publish set keeps it non-private.
      expect(pkgJson.private).toBeUndefined()
    })

    it('should have publishConfig for npm', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.publishConfig).toBeDefined()
      expect(pkgJson.publishConfig.access).toBe('public')
      expect(pkgJson.publishConfig.registry).toBe('https://registry.npmjs.org/')
    })
  })

  describe('Sentry integration in the main CLI', () => {
    it('main CLI should have CLI dispatch with Sentry entry point', () => {
      expect(
        existsSync(path.join(cliSrcDir, 'cli-dispatch-with-sentry.mts')),
      ).toBe(true)
    })

    it('main CLI should have Sentry instrumentation', () => {
      expect(
        existsSync(path.join(cliSrcDir, 'instrument-with-sentry.mts')),
      ).toBe(true)
    })
  })

  // Note: Structure/configuration assertions only; the build itself is not
  // invoked here.
})
