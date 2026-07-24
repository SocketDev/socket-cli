/**
 * @file Tests for the plain @socketsecurity/cli package template structure and
 *   configuration (no Sentry — that variant lives in cli-sentry-package).
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

describe('@socketsecurity/cli package template', () => {
  describe('package.json validation', () => {
    it('should have valid package.json metadata', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.name).toBe('@socketsecurity/cli')
      // Allow prerelease tags (e.g. 3.0.0-pre.0).
      expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/)
      expect(pkgJson.license).toBe('MIT')
      expect(pkgJson.description).toContain('Socket CLI')
      // The plain template carries no Sentry wiring.
      expect(pkgJson.description).not.toContain('Sentry')
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

    it('should not depend on Sentry', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.dependencies?.['@sentry/node']).toBeUndefined()
      expect(pkgJson.devDependencies?.['@sentry/node']).toBeUndefined()
    })

    it('should have rolldown build tooling as devDependencies', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.devDependencies).toBeDefined()
      expect(pkgJson.devDependencies.rolldown).toBeDefined()
      expect(pkgJson.devDependencies['build-infra']).toBe('workspace:*')
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

    it('should have rolldown CLI config', () => {
      expect(existsSync(path.join(configDir, 'rolldown.cli.mts'))).toBe(true)
    })

    it('should have rolldown index config', () => {
      expect(existsSync(path.join(configDir, 'rolldown.index.mts'))).toBe(true)
    })

    it('rolldown config should extend the base CLI config', async () => {
      const content = await fs.readFile(
        path.join(configDir, 'rolldown.cli.mts'),
        'utf-8',
      )

      expect(content).toContain(
        "import baseConfig from '../../cli/.config/rolldown.cli.mts'",
      )
    })

    it('rolldown config should use the plain CLI dispatch entry point', async () => {
      const content = await fs.readFile(
        path.join(configDir, 'rolldown.cli.mts'),
        'utf-8',
      )

      // Plain build: no Sentry instrumentation entry, no Sentry define.
      expect(content).toContain('cli-dispatch.mts')
      expect(content).not.toContain('cli-dispatch-with-sentry.mts')
      expect(content).not.toContain('INLINED_SENTRY_BUILD')
    })

    it('rolldown config should run the build when invoked directly', async () => {
      const content = await fs.readFile(
        path.join(configDir, 'rolldown.cli.mts'),
        'utf-8',
      )

      expect(content).toContain('runBuild(config')
      expect(content).toContain('import.meta.url')
    })
  })

  describe('build scripts exist', () => {
    it('should have scripts directory', () => {
      expect(existsSync(scriptsDir)).toBe(true)
    })

    it('should have build.mts script', () => {
      expect(existsSync(path.join(scriptsDir, 'build.mts'))).toBe(true)
    })

    it('build.mts should delegate to the rolldown config', async () => {
      const content = await fs.readFile(
        path.join(scriptsDir, 'build.mts'),
        'utf-8',
      )

      expect(content).toBeTruthy()
      expect(content).toContain('import')
      expect(content).toContain('rolldown.cli.mts')
    })

    it('should have verify-package.mts script', () => {
      expect(existsSync(path.join(scriptsDir, 'verify-package.mts'))).toBe(true)
    })
  })

  describe('README documentation', () => {
    it('should have README.md', () => {
      expect(existsSync(path.join(packageDir, 'README.md'))).toBe(true)
    })

    it('README should document the package', async () => {
      const readme = await fs.readFile(
        path.join(packageDir, 'README.md'),
        'utf-8',
      )

      expect(readme).toContain('@socketsecurity/cli')
      expect(readme).toContain('Socket CLI')
      expect(readme).toContain('npm install')
    })

    it('README should not document Sentry', async () => {
      const readme = await fs.readFile(
        path.join(packageDir, 'README.md'),
        'utf-8',
      )

      expect(readme).not.toContain('Sentry')
    })
  })

  describe('package is publishable', () => {
    it('should be marked as private during development', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      // The template is private during development but published on release.
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
})
