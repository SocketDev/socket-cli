/**
 * @fileoverview Tests for @socketsecurity/cli-with-sentry package structure and configuration.
 */

import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const configDir = path.join(packageDir, '.config')
const binDir = path.join(packageDir, 'bin')
const scriptsDir = path.join(packageDir, 'scripts')

describe('@socketsecurity/cli-with-sentry package', () => {
  describe('package.json validation', () => {
    it('should have valid package.json metadata', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.name).toBe('@socketsecurity/cli-with-sentry')
      expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(pkgJson.license).toBe('MIT')
      expect(pkgJson.description).toContain('Sentry')
      expect(pkgJson.description).toContain('telemetry')
    })

    it('should have build script', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.scripts).toBeDefined()
      expect(pkgJson.scripts.build).toBe('node scripts/build.mjs')
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

    it('should depend on main CLI package', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.dependencies).toBeDefined()
      expect(pkgJson.dependencies['@socketsecurity/cli']).toBe('workspace:*')
    })

    it('should have Sentry as devDependency', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.devDependencies).toBeDefined()
      expect(pkgJson.devDependencies['@sentry/node']).toBeDefined()
      expect(pkgJson.devDependencies.esbuild).toBeDefined()
    })
  })

  describe('bin wrappers exist', () => {
    it('should have bin directory', () => {
      expect(existsSync(binDir)).toBe(true)
    })

    it('should have cli.js wrapper', () => {
      const cliPath = path.join(binDir, 'cli.js')
      expect(existsSync(cliPath)).toBe(true)
    })

    it('should have npm-cli.js wrapper', () => {
      const npmPath = path.join(binDir, 'npm-cli.js')
      expect(existsSync(npmPath)).toBe(true)
    })

    it('should have npx-cli.js wrapper', () => {
      const npxPath = path.join(binDir, 'npx-cli.js')
      expect(existsSync(npxPath)).toBe(true)
    })

    it('should have pnpm-cli.js wrapper', () => {
      const pnpmPath = path.join(binDir, 'pnpm-cli.js')
      expect(existsSync(pnpmPath)).toBe(true)
    })

    it('should have yarn-cli.js wrapper', () => {
      const yarnPath = path.join(binDir, 'yarn-cli.js')
      expect(existsSync(yarnPath)).toBe(true)
    })

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

    it('should have esbuild config', () => {
      const esbuildPath = path.join(
        configDir,
        'esbuild.cli-sentry.build.mjs',
      )
      expect(existsSync(esbuildPath)).toBe(true)
    })

    it('esbuild config should import base config', async () => {
      const esbuildPath = path.join(
        configDir,
        'esbuild.cli-sentry.build.mjs',
      )
      const content = await fs.readFile(esbuildPath, 'utf-8')

      expect(content).toContain(
        "import baseConfig from '../../cli/.config/esbuild.cli.build.mjs'",
      )
    })

    it('esbuild config should enable Sentry build flag', async () => {
      const esbuildPath = path.join(
        configDir,
        'esbuild.cli-sentry.build.mjs',
      )
      const content = await fs.readFile(esbuildPath, 'utf-8')

      expect(content).toContain('INLINED_SOCKET_CLI_SENTRY_BUILD')
      expect(content).toContain("JSON.stringify('1')")
    })

    it('esbuild config should use CLI dispatch with Sentry entry point', async () => {
      const esbuildPath = path.join(
        configDir,
        'esbuild.cli-sentry.build.mjs',
      )
      const content = await fs.readFile(esbuildPath, 'utf-8')

      expect(content).toContain('cli-dispatch-with-sentry.mts')
    })

    it('esbuild config should call build() when run', async () => {
      const esbuildPath = path.join(
        configDir,
        'esbuild.cli-sentry.build.mjs',
      )
      const content = await fs.readFile(esbuildPath, 'utf-8')

      expect(content).toContain('build(config)')
      expect(content).toContain('import.meta.url')
    })
  })

  describe('build scripts exist', () => {
    it('should have scripts directory', () => {
      expect(existsSync(scriptsDir)).toBe(true)
    })

    it('should have build.mjs script', () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      expect(existsSync(buildPath)).toBe(true)
    })

    it('build.mjs should be valid JavaScript', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toBeTruthy()
      expect(content).toContain('import')
      expect(content).toContain('esbuild.cli-sentry.build.mjs')
    })
  })

  describe('README documentation', () => {
    it('should have README.md', () => {
      const readmePath = path.join(packageDir, 'README.md')
      expect(existsSync(readmePath)).toBe(true)
    })

    it('README should document Sentry integration', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')

      expect(readme).toContain('Sentry')
      expect(readme).toContain('telemetry')
      expect(readme).toContain('error')
    })

    it('README should document opt-out', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')

      expect(readme).toContain('Opt-Out')
      expect(readme).toContain('SOCKET_TELEMETRY')
    })

    it('README should document differences from main CLI', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')

      expect(readme).toContain('Differences')
      expect(readme).toContain('@socketsecurity/cli')
    })

    it('README should document privacy', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')

      expect(readme).toContain('No sensitive data')
      expect(readme.toLowerCase()).toContain('api token')
    })
  })

  describe('package is publishable', () => {
    it('should be marked as private', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      // cli-with-sentry is private during development but will be public on release.
      expect(pkgJson.private).toBe(true)
    })

    it('should have publishConfig for npm', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.publishConfig).toBeDefined()
      expect(pkgJson.publishConfig.access).toBe('public')
      expect(pkgJson.publishConfig.registry).toBe(
        'https://registry.npmjs.org/',
      )
    })
  })

  describe('Sentry integration', () => {
    it('main CLI should have CLI dispatch with Sentry entry point', () => {
      const sentryEntryPath = path.join(
        packageDir,
        '..',
        'cli',
        'src',
        'cli-dispatch-with-sentry.mts',
      )
      expect(existsSync(sentryEntryPath)).toBe(true)
    })

    it('CLI dispatch with Sentry should import instrumentation first', async () => {
      const sentryEntryPath = path.join(
        packageDir,
        '..',
        'cli',
        'src',
        'cli-dispatch-with-sentry.mts',
      )
      const content = await fs.readFile(sentryEntryPath, 'utf-8')

      expect(content).toContain("import './instrument-with-sentry.mts'")
      expect(content).toContain("import './cli-dispatch.mts'")

      // Verify Sentry import comes before CLI dispatch.
      const sentryImportIndex = content.indexOf('instrument-with-sentry')
      const dispatchImportIndex = content.indexOf('cli-dispatch.mts')
      expect(sentryImportIndex).toBeLessThan(dispatchImportIndex)
    })

    it('main CLI should have Sentry instrumentation', () => {
      const sentryInstrumentPath = path.join(
        packageDir,
        '..',
        'cli',
        'src',
        'instrument-with-sentry.mts',
      )
      expect(existsSync(sentryInstrumentPath)).toBe(true)
    })

    it('Sentry instrumentation should check build flag', async () => {
      const sentryInstrumentPath = path.join(
        packageDir,
        '..',
        'cli',
        'src',
        'instrument-with-sentry.mts',
      )
      const content = await fs.readFile(sentryInstrumentPath, 'utf-8')

      expect(content).toContain('INLINED_SOCKET_CLI_SENTRY_BUILD')
      expect(content).toContain('@sentry/node')
      expect(content).toContain('Sentry.init')
    })
  })

  // Note: Actual build execution tests are pending implementation.
  // These tests validate package structure and configuration only.
  describe.skip('build execution (requires implementation)', () => {
    it('should build Sentry-enabled CLI', async () => {
      // Test pending: verify build creates dist/cli.js with Sentry.
    })

    it('should include Sentry SDK in bundle', async () => {
      // Test pending: verify @sentry/node is bundled, not externalized.
    })

    it('should set SENTRY_BUILD flag in output', async () => {
      // Test pending: verify flag is set to "1" in built code.
    })
  })
})
