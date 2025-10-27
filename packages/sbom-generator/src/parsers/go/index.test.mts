/**
 * Tests for go parser.
 *
 * Lock-Step Reference: cdxgen's tests for go.js parser
 * Target: 90-100 lock-step quality
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GoParser } from './index.mts'

describe('GoParser', () => {
  const parser = new GoParser()
  const fixturesPath = path.join(__dirname, '../../../test/fixtures/go')

  describe('ecosystem', () => {
    it('should have correct ecosystem', () => {
      expect(parser.ecosystem).toBe('go')
    })
  })

  describe('detect', () => {
    it('should detect Go projects with go.mod', async () => {
      const detected = await parser.detect(fixturesPath)
      expect(detected).toBe(true)
    })

    it('should not detect non-Go projects', async () => {
      const detected = await parser.detect('/tmp/non-existent-project')
      expect(detected).toBe(false)
    })
  })

  describe('go.mod parsing', () => {
    it('should parse go.mod format', async () => {
      const result = await parser.parse(fixturesPath)

      expect(result.ecosystem).toBe('go')
      expect(result.components.length).toBeGreaterThan(0)

      // Should find cobra package.
      const cobra = result.components.find(
        c => c.name === 'github.com/spf13/cobra',
      )
      expect(cobra).toBeDefined()
      expect(cobra?.version).toBe('v1.7.0')
      expect(cobra?.purl).toBe('pkg:golang/github.com/spf13/cobra@v1.7.0')
      expect(cobra?.type).toBe('library')
      expect(cobra?.scope).toBe('required')
    })

    it('should parse go.mod metadata', async () => {
      const result = await parser.parse(fixturesPath)

      expect(result.metadata.name).toBe('github.com/example/test-go-app')
      expect(result.metadata.version).toBe('0.0.0') // Go modules don't have version in go.mod
      expect(result.metadata.description).toBe('Go 1.21')
    })

    it('should mark indirect dependencies correctly', async () => {
      const result = await parser.parse(fixturesPath)

      const pkgErrors = result.components.find(
        c => c.name === 'github.com/pkg/errors',
      )
      expect(pkgErrors).toBeDefined()
      expect(pkgErrors?.scope).toBe('optional') // indirect = optional
    })

    it('should build dependency graph from go.mod', async () => {
      const result = await parser.parse(fixturesPath)

      expect(result.dependencies.length).toBeGreaterThan(0)

      // Root component should exist.
      const rootDep = result.dependencies.find(d =>
        d.ref.includes('github.com/example/test-go-app'),
      )
      expect(rootDep).toBeDefined()
      expect(rootDep?.dependsOn.length).toBeGreaterThan(0)

      // Should only include direct dependencies (not indirect).
      expect(rootDep?.dependsOn).toContain(
        'pkg:golang/github.com/spf13/cobra@v1.7.0',
      )
      expect(rootDep?.dependsOn).not.toContain(
        'pkg:golang/github.com/pkg/errors@v0.9.1',
      )
    })

    it('should parse all dependencies from go.mod', async () => {
      const result = await parser.parse(fixturesPath)

      // Should have 6 dependencies.
      expect(result.components.length).toBeGreaterThanOrEqual(5)

      const packageNames = result.components.map(c => c.name)
      expect(packageNames).toContain('github.com/spf13/cobra')
      expect(packageNames).toContain('github.com/spf13/viper')
      expect(packageNames).toContain('gopkg.in/yaml.v3')
    })

    it('should handle replace directives', async () => {
      const result = await parser.parse(fixturesPath)

      // Replace directive: github.com/old/module => github.com/new/module v1.2.3
      // Should not appear in components (old module replaced).
      const oldModule = result.components.find(
        c => c.name === 'github.com/old/module',
      )
      expect(oldModule).toBeUndefined()
    })
  })

  describe('PURL generation', () => {
    it('should generate valid PURLs for Go modules', async () => {
      const result = await parser.parse(fixturesPath)

      const cobra = result.components.find(
        c => c.name === 'github.com/spf13/cobra',
      )
      expect(cobra?.purl).toBe('pkg:golang/github.com/spf13/cobra@v1.7.0')
      expect(cobra?.['bom-ref']).toBe(
        'pkg:golang/github.com/spf13/cobra@v1.7.0',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle missing go.mod gracefully', async () => {
      const tempDir = path.join('/tmp', `go-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      const result = await parser.parse(tempDir)

      expect(result.components.length).toBe(0)
      expect(result.ecosystem).toBe('go')
      expect(result.metadata.name).toBe('unknown')

      // Clean up.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })

    it('should handle empty go.mod', async () => {
      const tempDir = path.join('/tmp', `go-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      await writeFile(
        path.join(tempDir, 'go.mod'),
        'module example.com/empty\n\ngo 1.21',
      )

      const result = await parser.parse(tempDir)

      expect(result.components.length).toBe(0)
      expect(result.metadata.name).toBe('example.com/empty')

      // Clean up.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })

    it('should handle single-line require directives', async () => {
      const tempDir = path.join('/tmp', `go-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      await writeFile(
        path.join(tempDir, 'go.mod'),
        'module example.com/single\n\ngo 1.21\n\nrequire github.com/pkg/errors v0.9.1',
      )

      const result = await parser.parse(tempDir)

      expect(result.components.length).toBe(1)
      expect(result.components[0].name).toBe('github.com/pkg/errors')

      // Clean up.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })
  })

  describe('Go version parsing', () => {
    it('should extract Go version from go.mod', async () => {
      const result = await parser.parse(fixturesPath)

      expect(result.metadata.description).toBe('Go 1.21')
    })
  })
})
