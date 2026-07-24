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
      expect(pkgJson.devDependencies['@socketsecurity/cli']).toBe('workspace:*')
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

    it('bin wrappers should be executable', async () => {
      const cliPath = path.join(binDir, 'cli.js')
      const content = await fs.readFile(cliPath, 'utf-8')

      expect(content).toContain('#!/usr/bin/env node')
      expect(content).toContain('dist/cli.js')
    })
  })

  describe('build configuration', () => {
    it('should have .config directory', () => {
      expect(existsSync(configDir)).toBe(true)
    })

    it('should have rolldown config', () => {
      const rolldownPath = path.join(configDir, 'rolldown.cli-sentry.build.mts')
      expect(existsSync(rolldownPath)).toBe(true)
    })

    it('rolldown config should import base config', async () => {
      const rolldownPath = path.join(configDir, 'rolldown.cli-sentry.build.mts')
      const content = await fs.readFile(rolldownPath, 'utf-8')

      expect(content).toContain(
        "import baseConfig from '../../cli/.config/rolldown.cli.mts'",
      )
    })

    it('rolldown config should enable Sentry build flag', async () => {
      const rolldownPath = path.join(configDir, 'rolldown.cli-sentry.build.mts')
      const content = await fs.readFile(rolldownPath, 'utf-8')

      expect(content).toContain('INLINED_SENTRY_BUILD')
      expect(content).toContain("JSON.stringify('1')")
    })

    it('rolldown config should use CLI dispatch with Sentry entry point', async () => {
      const rolldownPath = path.join(configDir, 'rolldown.cli-sentry.build.mts')
      const content = await fs.readFile(rolldownPath, 'utf-8')

      expect(content).toContain('cli-dispatch-with-sentry.mts')
    })

    it('rolldown config should keep Sentry external', async () => {
      const rolldownPath = path.join(configDir, 'rolldown.cli-sentry.build.mts')
      const content = await fs.readFile(rolldownPath, 'utf-8')

      expect(content).toContain("external: '@sentry/node'")
    })

    it('rolldown config should run the build when invoked directly', async () => {
      const rolldownPath = path.join(configDir, 'rolldown.cli-sentry.build.mts')
      const content = await fs.readFile(rolldownPath, 'utf-8')

      expect(content).toContain('runBuild(config')
      expect(content).toContain('import.meta.url')
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

    it('build.mts should delegate to the rolldown config', async () => {
      const buildPath = path.join(scriptsDir, 'build.mts')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toBeTruthy()
      expect(content).toContain('import')
      expect(content).toContain('rolldown.cli-sentry.build.mts')
    })
  })

  describe('README documentation', () => {
    it('should have README.md', () => {
      const readmePath = path.join(packageDir, 'README.md')
      expect(existsSync(readmePath)).toBe(true)
    })

    it('README should document the Sentry variant', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')

      expect(readme).toContain('@socketsecurity/cli-with-sentry')
      expect(readme).toContain('Sentry')
      expect(readme).toContain('npm install')
    })
  })

  describe('package is publishable', () => {
    it('should be marked as private during development', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      // cli-with-sentry is private during development but public on release.
      expect(pkgJson.private).toBe(true)
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

    it('CLI dispatch with Sentry should import instrumentation first', async () => {
      const content = await fs.readFile(
        path.join(cliSrcDir, 'cli-dispatch-with-sentry.mts'),
        'utf-8',
      )

      expect(content).toContain("import './instrument-with-sentry.mts'")
      expect(content).toContain("import './cli-dispatch.mts'")

      // Verify Sentry import comes before CLI dispatch.
      const sentryImportIndex = content.indexOf('instrument-with-sentry')
      const dispatchImportIndex = content.indexOf('cli-dispatch.mts')
      expect(sentryImportIndex).toBeLessThan(dispatchImportIndex)
    })

    it('main CLI should have Sentry instrumentation', () => {
      expect(
        existsSync(path.join(cliSrcDir, 'instrument-with-sentry.mts')),
      ).toBe(true)
    })

    it('Sentry instrumentation should gate on the Sentry build flag', async () => {
      const content = await fs.readFile(
        path.join(cliSrcDir, 'instrument-with-sentry.mts'),
        'utf-8',
      )

      // The build-flag check lives behind the isSentryBuild() env accessor
      // (which reads INLINED_SENTRY_BUILD at build time).
      expect(content).toContain('isSentryBuild()')
      expect(content).toContain('@sentry/node')
      expect(content).toContain('Sentry.init')
    })
  })

  // Note: Structure/configuration assertions only; the build itself is not
  // invoked here.
})
