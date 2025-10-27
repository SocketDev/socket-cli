/**
 * Tests for pypi parser.
 *
 * Lock-Step Reference: cdxgen's tests for python.js parser
 * Target: 90-100 lock-step quality
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Component } from '../../types/sbom.mts'
import { PypiParser } from './index.mts'

describe('PypiParser', () => {
  const parser = new PypiParser()
  const fixturesPath = path.join(__dirname, '../../../test/fixtures/python')

  describe('ecosystem', () => {
    it('should have correct ecosystem', () => {
      expect(parser.ecosystem).toBe('pypi')
    })
  })

  describe('detect', () => {
    it('should detect Python projects with pyproject.toml', async () => {
      const detected = await parser.detect(fixturesPath)
      expect(detected).toBe(true)
    })

    it('should not detect non-Python projects', async () => {
      const detected = await parser.detect('/tmp/non-existent-project')
      expect(detected).toBe(false)
    })
  })

  describe('poetry.lock parsing', () => {
    it('should parse poetry.lock format', async () => {
      const result = await parser.parse(fixturesPath)

      expect(result.ecosystem).toBe('pypi')
      expect(result.components.length).toBeGreaterThan(0)

      // Should find requests package.
      const requests = result.components.find(c => c.name === 'requests')
      expect(requests).toBeDefined()
      expect(requests?.version).toBe('2.31.0')
      expect(requests?.purl).toBe('pkg:pypi/requests@2.31.0')
      expect(requests?.type).toBe('library')
      expect(requests?.scope).toBe('required')
    })

    it('should parse Poetry metadata from pyproject.toml', async () => {
      const result = await parser.parse(fixturesPath)

      expect(result.metadata.name).toBe('test-python-app')
      expect(result.metadata.version).toBe('1.0.0')
      expect(result.metadata.description).toBe('A test Python application')
      expect(result.metadata.homepage).toBe('https://example.com')
      expect(result.metadata.repository).toBe(
        'https://github.com/example/test-python-app',
      )
      expect(result.metadata.license).toBe('MIT')
    })

    it('should mark dev dependencies correctly', async () => {
      const result = await parser.parse(fixturesPath)

      const pytest = result.components.find(c => c.name === 'pytest')
      expect(pytest).toBeDefined()
      expect(pytest?.scope).toBe('optional')
    })

    it('should exclude dev dependencies when excludeDev is true', async () => {
      const result = await parser.parse(fixturesPath, { excludeDev: true })

      const pytest = result.components.find(c => c.name === 'pytest')
      expect(pytest).toBeUndefined()
    })

    it('should build dependency graph from poetry.lock', async () => {
      const result = await parser.parse(fixturesPath)

      expect(result.dependencies.length).toBeGreaterThan(0)

      // Root component should exist.
      const rootDep = result.dependencies.find(d =>
        d.ref.includes('test-python-app@1.0.0'),
      )
      expect(rootDep).toBeDefined()
      expect(rootDep?.dependsOn.length).toBeGreaterThan(0)

      // requests should have dependencies.
      const requestsDep = result.dependencies.find(d =>
        d.ref.includes('requests@2.31.0'),
      )
      expect(requestsDep).toBeDefined()
      expect(requestsDep?.dependsOn).toContain('pkg:pypi/certifi@2023.7.22')
      expect(requestsDep?.dependsOn).toContain('pkg:pypi/urllib3@2.0.4')
    })
  })

  describe('Pipfile.lock parsing', () => {
    let tempDir: string

    beforeEach(async () => {
      // Create temporary directory for Pipfile.lock test.
      tempDir = path.join('/tmp', `pypi-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      // Copy Pipfile.lock to temp directory.
      const pipfileLock = await readFile(
        path.join(fixturesPath, 'Pipfile.lock'),
        'utf8',
      )
      await writeFile(path.join(tempDir, 'Pipfile.lock'), pipfileLock)

      // Create minimal pyproject.toml.
      await writeFile(
        path.join(tempDir, 'pyproject.toml'),
        '[project]\nname = "pipfile-test"\nversion = "1.0.0"',
      )
    })

    afterEach(async () => {
      // Clean up temporary directory.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })

    it('should parse Pipfile.lock format', async () => {
      const result = await parser.parse(tempDir)

      expect(result.components.length).toBeGreaterThan(0)

      const requests = result.components.find(c => c.name === 'requests')
      expect(requests).toBeDefined()
      expect(requests?.version).toBe('2.31.0')
    })

    it('should parse dev dependencies from Pipfile.lock', async () => {
      const result = await parser.parse(tempDir)

      const pytest = result.components.find(c => c.name === 'pytest')
      expect(pytest).toBeDefined()
      expect(pytest?.scope).toBe('optional')
    })
  })

  describe('requirements.txt parsing', () => {
    let tempDir: string

    beforeEach(async () => {
      // Create temporary directory for requirements.txt test.
      tempDir = path.join('/tmp', `pypi-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      // Copy requirements.txt to temp directory.
      const requirementsTxt = await readFile(
        path.join(fixturesPath, 'requirements.txt'),
        'utf8',
      )
      await writeFile(path.join(tempDir, 'requirements.txt'), requirementsTxt)

      // Create minimal pyproject.toml.
      await writeFile(
        path.join(tempDir, 'pyproject.toml'),
        '[project]\nname = "requirements-test"\nversion = "1.0.0"',
      )
    })

    afterEach(async () => {
      // Clean up temporary directory.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })

    it('should parse requirements.txt format', async () => {
      const result = await parser.parse(tempDir)

      expect(result.components.length).toBeGreaterThan(0)

      const requests = result.components.find(c => c.name === 'requests')
      expect(requests).toBeDefined()
      expect(requests?.version).toBe('2.31.0')
    })

    it('should handle version ranges in requirements.txt', async () => {
      const result = await parser.parse(tempDir)

      // numpy uses >=1.20.0,<2.0.0 - should be parsed.
      const numpy = result.components.find(c => c.name === 'numpy')
      expect(numpy).toBeDefined()
      // Version not pinned in requirements.txt, so defaults to 0.0.0.
      expect(numpy?.version).toBe('0.0.0')
    })

    it('should handle extras in requirements.txt', async () => {
      const result = await parser.parse(tempDir)

      // flask[async] should be parsed.
      const flask = result.components.find(c => c.name === 'flask')
      expect(flask).toBeDefined()
      expect(flask?.version).toBe('2.3.0')
    })

    it('should skip comments and blank lines', async () => {
      const result = await parser.parse(tempDir)

      // Should have 9 packages (certifi, charset-normalizer, idna, requests, urllib3, flask, numpy, pandas, pytest, click).
      expect(result.components.length).toBeGreaterThanOrEqual(9)
    })

    it('should handle markers in requirements.txt', async () => {
      const result = await parser.parse(tempDir)

      // pytest with marker should be parsed.
      const pytest = result.components.find(c => c.name === 'pytest')
      expect(pytest).toBeDefined()
    })
  })

  describe('PURL generation', () => {
    it('should generate valid PURLs for Python packages', async () => {
      const result = await parser.parse(fixturesPath)

      const requests = result.components.find(c => c.name === 'requests')
      expect(requests?.purl).toBe('pkg:pypi/requests@2.31.0')
      expect(requests?.['bom-ref']).toBe('pkg:pypi/requests@2.31.0')
    })
  })

  describe('PEP 621 format', () => {
    let tempDir: string

    beforeEach(async () => {
      // Create temporary directory for PEP 621 test.
      tempDir = path.join('/tmp', `pypi-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      // Copy PEP 621 pyproject.toml.
      const pyprojectToml = await readFile(
        path.join(fixturesPath, 'pyproject-pep621.toml'),
        'utf8',
      )
      await writeFile(path.join(tempDir, 'pyproject.toml'), pyprojectToml)

      // Copy poetry.lock for dependencies.
      const poetryLock = await readFile(
        path.join(fixturesPath, 'poetry.lock'),
        'utf8',
      )
      await writeFile(path.join(tempDir, 'poetry.lock'), poetryLock)
    })

    afterEach(async () => {
      // Clean up temporary directory.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })

    it('should parse PEP 621 pyproject.toml metadata', async () => {
      const result = await parser.parse(tempDir)

      expect(result.metadata.name).toBe('test-pep621-app')
      expect(result.metadata.version).toBe('2.0.0')
      expect(result.metadata.description).toBe('A test PEP 621 application')
      expect(result.metadata.license).toBe('MIT')
    })
  })

  describe('edge cases', () => {
    it('should handle empty poetry.lock', async () => {
      const tempDir = path.join('/tmp', `pypi-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      await writeFile(
        path.join(tempDir, 'pyproject.toml'),
        '[project]\nname = "empty"\nversion = "0.0.0"',
      )
      await writeFile(
        path.join(tempDir, 'poetry.lock'),
        '[metadata]\npython-versions = "^3.8"',
      )

      const result = await parser.parse(tempDir)

      expect(result.components.length).toBe(0)

      // Clean up.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })

    it('should handle missing lockfile gracefully', async () => {
      const tempDir = path.join('/tmp', `pypi-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      await writeFile(
        path.join(tempDir, 'pyproject.toml'),
        '[project]\nname = "no-lock"\nversion = "0.0.0"',
      )

      const result = await parser.parse(tempDir)

      expect(result.components.length).toBe(0)
      expect(result.ecosystem).toBe('pypi')

      // Clean up.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })

    it('should handle malformed requirement lines', async () => {
      const tempDir = path.join('/tmp', `pypi-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      await writeFile(
        path.join(tempDir, 'pyproject.toml'),
        '[project]\nname = "malformed"\nversion = "0.0.0"',
      )
      await writeFile(
        path.join(tempDir, 'requirements.txt'),
        '# Valid\nrequests==2.31.0\n\n# Invalid lines\ngit+https://github.com/user/repo.git\nhttp://example.com/package.tar.gz\n',
      )

      const result = await parser.parse(tempDir)

      // Should only find requests, skip URL-based requirements.
      expect(result.components.length).toBe(1)
      expect(result.components[0].name).toBe('requests')

      // Clean up.
      await import('trash').then(({ trash }) => trash([tempDir]))
    })
  })
})
