/**
 * Unit tests for PURL parsing.
 *
 * Purpose:
 * Tests Package URL (PURL) parsing. Validates PURL spec compliance and component extraction.
 *
 * Test Coverage:
 * - PURL syntax parsing
 * - Namespace extraction
 * - Version parsing
 * - Qualifiers handling
 * - Subpath parsing
 * - Invalid PURL error handling
 *
 * Testing Approach:
 * Tests PURL parser with various ecosystem formats.
 *
 * Related Files:
 * - utils/purl/parse.mts (implementation)
 */

import { describe, expect, it, vi } from 'vitest'

import { PackageURL } from '@socketregistry/packageurl-js'

import {
  createPurlObject,
  getPurlObject,
  normalizePurl,
} from '../../../../src/utils/purl/parse.mts'

// Mock dependencies.
const mockIsObjectObject = vi.hoisted(() =>
  vi.fn(obj => obj !== null && typeof obj === 'object' && !Array.isArray(obj)),
)

vi.mock('@socketsecurity/lib/objects', () => ({
  isObjectObject: mockIsObjectObject,
}))

describe('purl utilities', () => {
  describe('normalizePurl', () => {
    it('adds pkg: prefix when missing', () => {
      expect(normalizePurl('npm/lodash@4.17.21')).toBe('pkg:npm/lodash@4.17.21')
    })

    it('keeps pkg: prefix when already present', () => {
      expect(normalizePurl('pkg:npm/lodash@4.17.21')).toBe(
        'pkg:npm/lodash@4.17.21',
      )
    })

    it('handles empty string', () => {
      expect(normalizePurl('')).toBe('pkg:')
    })
  })

  describe('createPurlObject', () => {
    it('creates PURL from type and name', () => {
      const purl = createPurlObject('npm', 'lodash')
      expect(purl).toBeInstanceOf(PackageURL)
      expect(purl?.type).toBe('npm')
      expect(purl?.name).toBe('lodash')
    })

    it('creates PURL from options object', () => {
      const purl = createPurlObject({
        type: 'npm',
        name: 'lodash',
        version: '4.17.21',
      })
      expect(purl).toBeInstanceOf(PackageURL)
      expect(purl?.type).toBe('npm')
      expect(purl?.name).toBe('lodash')
      expect(purl?.version).toBe('4.17.21')
    })

    it('creates PURL with namespace', () => {
      const purl = createPurlObject({
        type: 'npm',
        namespace: '@socketsecurity',
        name: 'cli',
        version: '1.0.0',
      })
      expect(purl).toBeInstanceOf(PackageURL)
      expect(purl?.namespace).toBe('@socketsecurity')
    })

    it('creates PURL with qualifiers', () => {
      const purl = createPurlObject({
        type: 'npm',
        name: 'package',
        qualifiers: { arch: 'x64', os: 'linux' },
      })
      expect(purl).toBeInstanceOf(PackageURL)
      expect(purl?.qualifiers).toEqual({ arch: 'x64', os: 'linux' })
    })

    it('creates PURL with subpath', () => {
      const purl = createPurlObject({
        type: 'npm',
        name: 'package',
        subpath: 'lib/index.js',
      })
      expect(purl).toBeInstanceOf(PackageURL)
      expect(purl?.subpath).toBe('lib/index.js')
    })

    it('throws on invalid input by default', () => {
      expect(() => createPurlObject('', '')).toThrow()
    })

    it('returns undefined on invalid input when throws: false', () => {
      const purl = createPurlObject('', '', { throws: false })
      expect(purl).toBeUndefined()
    })

    it('handles type string with name string and options', () => {
      const purl = createPurlObject('pypi', 'requests', {
        version: '2.31.0',
      })
      expect(purl?.type).toBe('pypi')
      expect(purl?.name).toBe('requests')
      expect(purl?.version).toBe('2.31.0')
    })

    it('handles type string with options object as second param', () => {
      const purl = createPurlObject('cargo', {
        name: 'tokio',
        version: '1.0.0',
      })
      expect(purl?.type).toBe('cargo')
      expect(purl?.name).toBe('tokio')
      expect(purl?.version).toBe('1.0.0')
    })
  })

  describe('getPurlObject', () => {
    it('parses PURL string', () => {
      const purl = getPurlObject('pkg:npm/lodash@4.17.21')
      expect(purl).toBeInstanceOf(PackageURL)
      expect(purl?.type).toBe('npm')
      expect(purl?.name).toBe('lodash')
      expect(purl?.version).toBe('4.17.21')
    })

    it('normalizes PURL string without pkg: prefix', () => {
      const purl = getPurlObject('npm/lodash@4.17.21')
      expect(purl).toBeInstanceOf(PackageURL)
      expect(purl?.type).toBe('npm')
      expect(purl?.name).toBe('lodash')
    })

    it('returns PackageURL object as-is', () => {
      const input = new PackageURL('npm', undefined, 'lodash', '4.17.21')
      const purl = getPurlObject(input)
      expect(purl).toBe(input)
    })

    it('handles SocketArtifact object', () => {
      const artifact = { type: 'npm', name: 'package' } as any
      const purl = getPurlObject(artifact)
      expect(purl).toBe(artifact)
    })

    it('throws on invalid PURL string by default', () => {
      expect(() => getPurlObject('invalid-purl')).toThrow()
    })

    it('returns undefined on invalid PURL when throws: false', () => {
      const purl = getPurlObject('invalid-purl', { throws: false })
      expect(purl).toBeUndefined()
    })

    it('parses complex PURL with all components', () => {
      const purl = getPurlObject(
        'pkg:maven/org.apache.commons/commons-lang3@3.12.0?classifier=sources#path/to/file',
      )
      expect(purl?.type).toBe('maven')
      expect(purl?.namespace).toBe('org.apache.commons')
      expect(purl?.name).toBe('commons-lang3')
      expect(purl?.version).toBe('3.12.0')
      expect(purl?.qualifiers).toEqual({ classifier: 'sources' })
      expect(purl?.subpath).toBe('path/to/file')
    })

    it('handles gem PURL', () => {
      const purl = getPurlObject('pkg:gem/rails@7.0.0')
      expect(purl?.type).toBe('gem')
      expect(purl?.name).toBe('rails')
      expect(purl?.version).toBe('7.0.0')
    })

    it('handles go PURL with namespace', () => {
      const purl = getPurlObject('pkg:go/github.com/gorilla/mux@1.8.0')
      expect(purl?.type).toBe('go')
      expect(purl?.namespace).toBe('github.com/gorilla')
      expect(purl?.name).toBe('mux')
      expect(purl?.version).toBe('1.8.0')
    })

    it('handles pypi PURL', () => {
      const purl = getPurlObject('pkg:pypi/django@4.2')
      expect(purl?.type).toBe('pypi')
      expect(purl?.name).toBe('django')
      expect(purl?.version).toBe('4.2')
    })
  })
})
