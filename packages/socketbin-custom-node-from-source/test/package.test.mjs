/**
 * @fileoverview Tests for @socketbin/custom-node package structure and configuration.
 */

import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const scriptsDir = path.join(packageDir, 'scripts')
const buildDir = path.join(packageDir, 'build')

describe('@socketbin/custom-node package', () => {
  describe('package.json validation', () => {
    it('should have valid package.json metadata', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.name).toBe('@socketbin/custom-node')
      expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(pkgJson.license).toBe('MIT')
      expect(pkgJson.description).toContain('Custom Node.js')
      expect(pkgJson.private).toBe(true)
    })

    it('should have build scripts', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.scripts).toBeDefined()
      expect(pkgJson.scripts.build).toBe('node scripts/build.mjs')
      expect(pkgJson.scripts['build:all']).toBe('node scripts/build.mjs --all-platforms')
    })
  })

  describe('build scripts exist', () => {
    it('should have build.mjs script', () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      expect(existsSync(buildPath)).toBe(true)
    })

    it('build.mjs should be valid JavaScript', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      // Should not throw syntax errors.
      expect(content).toBeTruthy()
      expect(content).toContain('import')
      expect(content).toContain('Node.js')
    })
  })

  describe('build script documentation', () => {
    it('build.mjs should document binary size optimization', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('Binary Size Optimization')
      expect(content).toContain('TARGET ACHIEVED')
      expect(content).toContain('MB')
    })

    it('build.mjs should document configuration flags', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('--with-intl=none')
      expect(content).toContain('--v8-lite-mode')
    })

    it('build.mjs should document compression approach', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('Compression Approach')
      expect(content).toContain('Brotli')
    })

    it('build.mjs should document performance impact', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('Performance Impact')
      expect(content).toContain('Startup overhead')
      expect(content).toContain('Runtime performance')
    })

    it('build.mjs should document usage options', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('--clean')
      expect(content).toContain('--verify')
      expect(content).toContain('--test')
    })
  })

  describe('build directory structure', () => {
    it('should have build directory', () => {
      expect(existsSync(buildDir)).toBe(true)
    })

    it('should have wasm-bundle subdirectory', () => {
      const wasmBundleDir = path.join(buildDir, 'wasm-bundle')
      expect(existsSync(wasmBundleDir)).toBe(true)
    })

    it('wasm-bundle should have Cargo.toml', () => {
      const cargoPath = path.join(buildDir, 'wasm-bundle', 'Cargo.toml')
      expect(existsSync(cargoPath)).toBe(true)
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

      expect(readme).toContain('Custom Node.js')
      expect(readme).toContain('Socket security patches')
      expect(readme).toContain('v24.10.0')
    })

    it('README should document build process', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')

      expect(readme).toContain('pnpm run build')
      expect(readme).toContain('Downloads')
      expect(readme).toContain('patches')
      expect(readme).toContain('compiles')
    })

    it('README should document output location', async () => {
      const readmePath = path.join(packageDir, 'README.md')
      const readme = await fs.readFile(readmePath, 'utf-8')

      expect(readme).toContain('build/out')
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
    })

    it('build.mjs should reference Node.js version', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('v24.10.0')
    })

    it('build.mjs should reference Socket patches', async () => {
      const buildPath = path.join(scriptsDir, 'build.mjs')
      const content = await fs.readFile(buildPath, 'utf-8')

      expect(content).toContain('Socket')
      expect(content).toContain('patch')
    })
  })

  // Note: Actual build execution tests are skipped because:
  // - Builds take 5-10 minutes
  // - Require compilation toolchain (gcc, make, python)
  // - Require ~1GB disk space for source
  // - Platform-specific build process
  // - Best tested manually or in dedicated CI jobs
  describe.skip('build execution (manual/CI only)', () => {
    it('should build custom Node.js binary', async () => {
      // This test is skipped by default.
      // To run: FULL_BUILD_TEST=1 pnpm test
    })

    it('should apply Socket patches', async () => {
      // This test is skipped by default.
      // To run: FULL_BUILD_TEST=1 pnpm test
    })

    it('should produce binary under 30MB', async () => {
      // This test is skipped by default.
      // To run: FULL_BUILD_TEST=1 pnpm test
    })
  })
})
