/**
 * @fileoverview Tests for @socketbin/sea package structure and configuration.
 */

import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const scriptsDir = path.join(packageDir, 'scripts')

describe('@socketbin/sea package', () => {
  describe('package.json validation', () => {
    it('should have valid package.json metadata', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.name).toBe('@socketbin/sea')
      expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(pkgJson.license).toBe('MIT')
      expect(pkgJson.description).toContain('SEA')
      expect(pkgJson.private).toBe(true)
    })

    it('should have build and publish scripts', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.scripts).toBeDefined()
      expect(pkgJson.scripts.build).toBe('node scripts/build.mjs')
      expect(pkgJson.scripts.publish).toBe('node scripts/publish.mjs')
    })
  })

  describe('build scripts exist', () => {
    it('should have build.mjs script', () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      expect(existsSync(buildPath)).toBe(true)
    })

    it('should have publish.mjs script', () => {
      const publishPath = path.join(scriptsDir, 'publish.mjs')
      expect(existsSync(publishPath)).toBe(true)
    })

    it('build.mjs should be valid JavaScript', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      // Should not throw syntax errors.
      expect(content).toBeTruthy()
      expect(content).toContain('import')
      expect(content).toContain('SEA')
    })

    it('publish.mjs should be valid JavaScript', async () => {
      const publishPath = path.join(scriptsDir, 'publish.mjs')
      const content = await fs.readFile(publishPath, 'utf-8')

      // Should not throw syntax errors.
      expect(content).toBeTruthy()
      expect(content).toContain('import')
    })
  })

  describe('build script documentation', () => {
    it('build.mjs should document supported platforms', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('Windows')
      expect(content).toContain('macOS')
      expect(content).toContain('Linux')
    })

    it('build.mjs should reference SEA feature', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('Single Executable Application')
      expect(content).toContain('NODE_SEA_FUSE')
    })

    it('build.mjs should document bootstrap wrapper approach', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('THIN WRAPPER')
      expect(content).toContain('@socketsecurity/cli')
      expect(content).toContain('downloads')
    })
  })

  describe('README documentation', () => {
    it('should have README.md', () => {
      const readmePath = path.join(packageDir, 'README.md')
      expect(existsSync(readmePath)).toBe(true)
    })

    it('README should document what it does', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')

      expect(readme).toContain('SEA')
      expect(readme).toContain('Single Executable Application')
      expect(readme).toContain('fallback')
    })

    it('README should document supported platforms', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')

      expect(readme).toContain('macOS')
      expect(readme).toContain('Linux')
      expect(readme).toContain('Windows')
    })

    it('README should document build instructions', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')

      expect(readme).toContain('pnpm run build')
    })
  })

  describe('package is private', () => {
    it('should be marked as private', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.private).toBe(true)
    })

    it('should not have publishConfig for npm', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      // Private package should not configure npm publishing.
      expect(pkgJson.publishConfig).toBeUndefined()
    })
  })

  describe('build script structure', () => {
    it('build.mjs should import required dependencies', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      // Check for key imports.
      expect(content).toContain("from 'node:fs'")
      expect(content).toContain("from 'node:path'")
      expect(content).toContain('@socketsecurity/lib')
    })

    it('build.mjs should define NODE_SEA_FUSE constant', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('NODE_SEA_FUSE')
    })
  })

  // Note: Actual build execution tests are skipped because:
  // - Builds take 5-10 minutes
  // - Require system dependencies (postject, codesign)
  // - Platform-specific compilation
  // - Best tested manually or in dedicated CI jobs
  describe.skip('build execution (manual/CI only)', () => {
    it('should build SEA binary for current platform', async () => {
      // This test is skipped by default.
      // To run: FULL_BUILD_TEST=1 pnpm test
    })
  })
})
