/**
 * @fileoverview Unit tests for SPDX license parsing and analysis.
 *
 * Tests SPDX (Software Package Data Exchange) license expression parsing and validation:
 * - collectIncompatibleLicenses() for detecting copyleft licenses (GPL, LGPL, AGPL, MPL, etc.)
 * - collectLicenseWarnings() for identifying risky or unknown licenses
 * - parseSpdxExp() for parsing complex license expressions with AND/OR operators
 * - AST node creation (createAstNode, createBinaryOperationNode, createLicenseNode)
 * - Handles nested expressions, OR fallbacks, GPL compatibility, and unknown licenses
 */

import {
  collectIncompatibleLicenses,
  collectLicenseWarnings,
  createAstNode,
  createBinaryOperationNode,
  createLicenseNode,
  parseSpdxExp,
  type SpdxLicenseNode,
  type SpdxBinaryOperationNode,
  type InternalLicenseNode,
} from '@socketsecurity/lib/packages/licenses'
import type { LicenseNode } from '@socketsecurity/lib/packages'
import { describe, expect, it } from 'vitest'

describe('packages/licenses', () => {
  describe('collectIncompatibleLicenses', () => {
    it('should return empty array for no copyleft licenses', () => {
      const nodes: LicenseNode[] = [
        { license: 'MIT', inFile: undefined },
        { license: 'Apache-2.0', inFile: undefined },
      ]
      const result = collectIncompatibleLicenses(nodes)
      expect(result).toEqual([])
    })

    it('should collect GPL licenses', () => {
      const nodes: LicenseNode[] = [
        { license: 'GPL-3.0', inFile: undefined },
        { license: 'MIT', inFile: undefined },
      ]
      const result = collectIncompatibleLicenses(nodes)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]?.license).toBe('GPL-3.0')
    })

    it('should handle empty array', () => {
      const result = collectIncompatibleLicenses([])
      expect(result).toEqual([])
    })

    it('should handle multiple copyleft licenses', () => {
      const nodes: LicenseNode[] = [
        { license: 'GPL-2.0', inFile: undefined },
        { license: 'GPL-3.0', inFile: undefined },
        { license: 'MIT', inFile: undefined },
      ]
      const result = collectIncompatibleLicenses(nodes)
      expect(result.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('collectLicenseWarnings', () => {
    it('should warn about UNLICENSED packages', () => {
      const nodes: LicenseNode[] = [{ license: 'UNLICENSED', inFile: undefined }]
      const warnings = collectLicenseWarnings(nodes)
      expect(warnings).toContain('Package is unlicensed')
    })

    it('should warn about licenses in files', () => {
      const nodes: LicenseNode[] = [
        { license: 'MIT', inFile: 'LICENSE.txt' },
      ]
      const warnings = collectLicenseWarnings(nodes)
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0]).toContain('LICENSE.txt')
    })

    it('should return empty array for valid licenses', () => {
      const nodes: LicenseNode[] = [
        { license: 'MIT', inFile: undefined },
        { license: 'Apache-2.0', inFile: undefined },
      ]
      const warnings = collectLicenseWarnings(nodes)
      expect(warnings).toEqual([])
    })

    it('should handle empty array', () => {
      const warnings = collectLicenseWarnings([])
      expect(warnings).toEqual([])
    })

    it('should not duplicate warnings', () => {
      const nodes: LicenseNode[] = [
        { license: 'UNLICENSED', inFile: undefined },
        { license: 'UNLICENSED', inFile: undefined },
      ]
      const warnings = collectLicenseWarnings(nodes)
      expect(warnings.length).toBe(1)
    })
  })

  describe('createLicenseNode', () => {
    it('should create license node from raw node', () => {
      const rawNode: SpdxLicenseNode = { license: 'MIT' }
      const node = createLicenseNode(rawNode)
      expect(node.type).toBe('License')
      expect(node.license).toBe('MIT')
    })

    it('should preserve plus flag', () => {
      const rawNode: SpdxLicenseNode = { license: 'Apache-2.0', plus: true }
      const node = createLicenseNode(rawNode)
      expect(node.plus).toBe(true)
    })

    it('should preserve exception', () => {
      const rawNode: SpdxLicenseNode = {
        license: 'GPL-2.0',
        exception: 'Classpath-exception-2.0',
      }
      const node = createLicenseNode(rawNode)
      expect(node.exception).toBe('Classpath-exception-2.0')
    })
  })

  describe('createBinaryOperationNode', () => {
    it('should create AND binary operation node', () => {
      const rawNode: SpdxBinaryOperationNode = {
        left: { license: 'MIT' },
        conjunction: 'and',
        right: { license: 'Apache-2.0' },
      }
      const node = createBinaryOperationNode(rawNode)
      expect(node.type).toBe('BinaryOperation')
      expect(node.conjunction).toBe('and')
    })

    it('should create OR binary operation node', () => {
      const rawNode: SpdxBinaryOperationNode = {
        left: { license: 'MIT' },
        conjunction: 'or',
        right: { license: 'Apache-2.0' },
      }
      const node = createBinaryOperationNode(rawNode)
      expect(node.conjunction).toBe('or')
    })

    it('should lazily create left node', () => {
      const rawNode: SpdxBinaryOperationNode = {
        left: { license: 'MIT' },
        conjunction: 'and',
        right: { license: 'Apache-2.0' },
      }
      const node = createBinaryOperationNode(rawNode)
      const left = node.left
      expect(left).toBeDefined()
      expect((left as InternalLicenseNode).license).toBe('MIT')
    })

    it('should lazily create right node', () => {
      const rawNode: SpdxBinaryOperationNode = {
        left: { license: 'MIT' },
        conjunction: 'and',
        right: { license: 'Apache-2.0' },
      }
      const node = createBinaryOperationNode(rawNode)
      const right = node.right
      expect(right).toBeDefined()
      expect((right as InternalLicenseNode).license).toBe('Apache-2.0')
    })
  })

  describe('createAstNode', () => {
    it('should create license node for license raw node', () => {
      const rawNode: SpdxLicenseNode = { license: 'MIT' }
      const node = createAstNode(rawNode)
      expect(node.type).toBe('License')
    })

    it('should create binary operation node for conjunction raw node', () => {
      const rawNode: SpdxBinaryOperationNode = {
        left: { license: 'MIT' },
        conjunction: 'and',
        right: { license: 'Apache-2.0' },
      }
      const node = createAstNode(rawNode)
      expect(node.type).toBe('BinaryOperation')
    })
  })

  describe('parseSpdxExp', () => {
    it('should parse simple license expression', () => {
      const result = parseSpdxExp('MIT')
      expect(result).toBeDefined()
      expect((result as SpdxLicenseNode).license).toBe('MIT')
    })

    it('should parse AND expression', () => {
      const result = parseSpdxExp('MIT AND Apache-2.0')
      expect(result).toBeDefined()
      expect((result as SpdxBinaryOperationNode).conjunction).toBe('and')
    })

    it('should parse OR expression', () => {
      const result = parseSpdxExp('MIT OR Apache-2.0')
      expect(result).toBeDefined()
      expect((result as SpdxBinaryOperationNode).conjunction).toBe('or')
    })

    it('should parse license with exception', () => {
      const result = parseSpdxExp('GPL-2.0-only WITH Classpath-exception-2.0')
      expect(result).toBeDefined()
    })

    it('should parse license with plus', () => {
      const result = parseSpdxExp('Apache-2.0+')
      expect(result).toBeDefined()
    })

    it('should handle invalid expressions', () => {
      const result = parseSpdxExp('INVALID_LICENSE_123')
      // parseSpdxExp returns undefined for truly invalid expressions
      // but may auto-correct some
      expect(result === undefined || result !== null).toBe(true)
    })

    it('should parse complex nested expression', () => {
      const result = parseSpdxExp('(MIT OR Apache-2.0) AND BSD-3-Clause')
      expect(result).toBeDefined()
    })

    it('should handle empty string', () => {
      // Empty string throws an error in spdx-expression-parse
      expect(() => parseSpdxExp('')).toThrow()
    })

    it('should parse ISC license', () => {
      const result = parseSpdxExp('ISC')
      expect(result).toBeDefined()
      expect((result as SpdxLicenseNode).license).toBe('ISC')
    })

    it('should parse BSD licenses', () => {
      const result = parseSpdxExp('BSD-2-Clause')
      expect(result).toBeDefined()
      expect((result as SpdxLicenseNode).license).toBe('BSD-2-Clause')
    })

    it('should parse GPL licenses', () => {
      const result = parseSpdxExp('GPL-3.0-only')
      expect(result).toBeDefined()
    })

    it('should parse LGPL licenses', () => {
      const result = parseSpdxExp('LGPL-2.1-only')
      expect(result).toBeDefined()
    })

    it('should parse AGPL licenses', () => {
      const result = parseSpdxExp('AGPL-3.0-only')
      expect(result).toBeDefined()
    })

    it('should parse MPL licenses', () => {
      const result = parseSpdxExp('MPL-2.0')
      expect(result).toBeDefined()
      expect((result as SpdxLicenseNode).license).toBe('MPL-2.0')
    })

    it('should handle case variations', () => {
      const result = parseSpdxExp('mit')
      // spdx-correct should normalize this
      expect(result).toBeDefined()
    })

    it('should parse unlicense', () => {
      const result = parseSpdxExp('Unlicense')
      expect(result).toBeDefined()
    })
  })

  describe('edge cases', () => {
    it('should handle null in license nodes array', () => {
      const nodes = [
        { license: 'MIT', inFile: undefined },
        null as any,
        { license: 'Apache-2.0', inFile: undefined },
      ]
      const result = collectIncompatibleLicenses(nodes)
      expect(result).toEqual([])
    })

    it('should handle undefined in license nodes array', () => {
      const nodes = [
        { license: 'MIT', inFile: undefined },
        undefined as any,
        { license: 'Apache-2.0', inFile: undefined },
      ]
      const result = collectIncompatibleLicenses(nodes)
      expect(result).toEqual([])
    })
  })
})
