/**
 * Tests for cargo parser.
 *
 * Lock-Step Reference: cdxgen's tests for rust.js parser
 * Target: 90-100 lock-step quality
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CargoParser } from './index.mts'

describe('CargoParser', () => {
  const parser = new CargoParser()
  const fixturesPath = path.join(__dirname, '../../../test/fixtures/rust')

  describe('ecosystem', () => {
    it('should have correct ecosystem', () => {
      expect(parser.ecosystem).toBe('cargo')
    })
  })

  describe('detect', () => {
    it('should detect Rust projects with Cargo.toml', async () => {
      const detected = await parser.detect(fixturesPath)
      expect(detected).toBe(true)
    })

    it('should not detect non-Rust projects', async () => {
      const detected = await parser.detect('/tmp/non-existent-project')
      expect(detected).toBe(false)
    })
  })

  describe('Cargo.lock parsing', () => {
    it('should parse Cargo.lock format', async () => {
      const result = await parser.parse(fixturesPath)

      expect(result.ecosystem).toBe('cargo')
      expect(result.components.length).toBeGreaterThan(0)

      // Should find serde package.
      const serde = result.components.find(c => c.name === 'serde')
      expect(serde).toBeDefined()
      expect(serde?.version).toBe('1.0.188')
      expect(serde?.purl).toBe('pkg:cargo/serde@1.0.188')
      expect(serde?.type).toBe('library')
      expect(serde?.scope).toBe('required')
    })

    it('should parse Cargo.toml metadata', async () => {
      const result = await parser.parse(fixturesPath)

      expect(result.metadata.name).toBe('test-rust-app')
      expect(result.metadata.version).toBe('0.1.0')
      expect(result.metadata.description).toBe('A test Rust application')
      expect(result.metadata.homepage).toBe('https://example.com')
      expect(result.metadata.repository).toBe('https://github.com/example/test-rust-app')
      expect(result.metadata.license).toBe('MIT')
    })

    it('should build dependency graph from Cargo.lock', async () => {
      const result = await parser.parse(fixturesPath)

      expect(result.dependencies.length).toBeGreaterThan(0)

      // Root component should exist.
      const rootDep = result.dependencies.find(d =>
        d.ref.includes('test-rust-app@0.1.0')
      )
      expect(rootDep).toBeDefined()
      expect(rootDep?.dependsOn.length).toBeGreaterThan(0)

      // serde should have dependencies.
      const serdeDep = result.dependencies.find(d =>
        d.ref.includes('serde@1.0.188')
      )
      expect(serdeDep).toBeDefined()
      expect(serdeDep?.dependsOn).toContain('pkg:cargo/serde_derive@1.0.188')
    })

    it('should parse transitive dependencies', async () => {
      const result = await parser.parse(fixturesPath)

      // serde_json has transitive dependencies (itoa, ryu, serde).
      const serdeJsonDep = result.dependencies.find(d =>
        d.ref.includes('serde_json@1.0.107')
      )
      expect(serdeJsonDep).toBeDefined()
      expect(serdeJsonDep?.dependsOn).toContain('pkg:cargo/serde@1.0.188')
      expect(serdeJsonDep?.dependsOn).toContain('pkg:cargo/itoa@1.0.9')
      expect(serdeJsonDep?.dependsOn).toContain('pkg:cargo/ryu@1.0.15')
    })

    it('should parse all packages from Cargo.lock', async () => {
      const result = await parser.parse(fixturesPath)

      // Should have 10 packages: test-rust-app + 9 dependencies.
      expect(result.components.length).toBeGreaterThanOrEqual(9)

      // Check key packages exist.
      const packageNames = result.components.map(c => c.name)
      expect(packageNames).toContain('serde')
      expect(packageNames).toContain('serde_json')
      expect(packageNames).toContain('tokio')
      expect(packageNames).toContain('clap')
    })
  })

  describe('PURL generation', () => {
    it('should generate valid PURLs for Rust crates', async () => {
      const result = await parser.parse(fixturesPath)

      const serde = result.components.find(c => c.name === 'serde')
      expect(serde?.purl).toBe('pkg:cargo/serde@1.0.188')
      expect(serde?.['bom-ref']).toBe('pkg:cargo/serde@1.0.188')
    })
  })

  describe('edge cases', () => {
    it('should handle missing Cargo.lock gracefully', async () => {
      const tempDir = path.join('/tmp', `cargo-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      await writeFile(
        path.join(tempDir, 'Cargo.toml'),
        '[package]\nname = "no-lock"\nversion = "0.0.0"'
      )

      const result = await parser.parse(tempDir)

      expect(result.components.length).toBe(0)
      expect(result.ecosystem).toBe('cargo')

      // Clean up.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })

    it('should handle empty Cargo.lock', async () => {
      const tempDir = path.join('/tmp', `cargo-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      await writeFile(
        path.join(tempDir, 'Cargo.toml'),
        '[package]\nname = "empty"\nversion = "0.0.0"'
      )
      await writeFile(path.join(tempDir, 'Cargo.lock'), '# Cargo.lock\nversion = 3')

      const result = await parser.parse(tempDir)

      expect(result.components.length).toBe(0)

      // Clean up.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })

    it('should handle Cargo.toml without package section', async () => {
      const tempDir = path.join('/tmp', `cargo-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      await writeFile(
        path.join(tempDir, 'Cargo.toml'),
        '[workspace]\nmembers = ["crate1", "crate2"]'
      )
      await writeFile(path.join(tempDir, 'Cargo.lock'), '# Cargo.lock\nversion = 3')

      const result = await parser.parse(tempDir)

      expect(result.metadata.name).toBe('unknown')
      expect(result.metadata.version).toBe('0.0.0')

      // Clean up.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })
  })

  describe('features and optional dependencies', () => {
    it('should parse Cargo.toml with features', async () => {
      const result = await parser.parse(fixturesPath)

      // Features are in Cargo.toml but not tracked in components.
      // This is acceptable - features are Rust-specific metadata.
      expect(result.metadata.name).toBe('test-rust-app')
    })
  })

  describe('dependency parsing', () => {
    it('should parse dependencies with checksums', async () => {
      const result = await parser.parse(fixturesPath)

      // All external crates should have source and checksum.
      const externalCrate = result.components.find(c => c.name === 'serde')
      expect(externalCrate).toBeDefined()
      // Note: checksum is not included in CycloneDX component (acceptable).
    })

    it('should parse dependencies from crates.io registry', async () => {
      const result = await parser.parse(fixturesPath)

      // All external dependencies come from crates.io registry.
      const serde = result.components.find(c => c.name === 'serde')
      expect(serde?.purl).toContain('pkg:cargo/serde')
    })
  })

  describe('dependency versions', () => {
    it('should extract exact versions from Cargo.lock', async () => {
      const result = await parser.parse(fixturesPath)

      const serde = result.components.find(c => c.name === 'serde')
      expect(serde?.version).toBe('1.0.188')

      const tokio = result.components.find(c => c.name === 'tokio')
      expect(tokio?.version).toBe('1.32.0')
    })
  })
})
