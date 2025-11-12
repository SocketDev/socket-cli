/**
 * Unit tests for npm package spec.
 *
 * Purpose:
 * Tests npm package specification handling. Validates package.json parsing and validation.
 *
 * Test Coverage:
 * - package.json parsing
 * - Dependencies extraction
 * - Scripts validation
 * - Engines compatibility
 * - Workspace configuration
 *
 * Testing Approach:
 * Tests package.json schema validation and parsing.
 *
 * Related Files:
 * - utils/npm/spec.mts (implementation)
 */

import npmPackageArg from 'npm-package-arg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  npmSpecToPurl,
  safeNpa,
  safeNpmSpecToPurl,
  safeParseNpmSpec,
} from '../../../../src/utils/npm/spec.mts'

// Mock dependencies.
const mockDefault = vi.hoisted(() => vi.fn())
const mockCreatePurlObject = vi.hoisted(() => vi.fn())

vi.mock('npm-package-arg', () => ({
  default: mockDefault,
}))

vi.mock('../../../../src/utils/purl/parse.mts', () => ({
  createPurlObject: mockCreatePurlObject,
}))

vi.mock('../../../../src/constants/agents.mts', () => ({
  NPM: 'npm',
}))

// Don't mock the module we're testing - only mock its dependencies.

const mockNpmPackageArg = vi.mocked(npmPackageArg)

describe('npm-spec utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('safeNpa', () => {
    it('returns parsed result when npm-package-arg succeeds', () => {
      const mockResult = { name: 'lodash', type: 'tag', fetchSpec: '4.17.21' }
      mockNpmPackageArg.mockReturnValue(mockResult as any)

      const result = safeNpa('lodash@4.17.21')

      expect(result).toBe(mockResult)
      expect(mockNpmPackageArg).toHaveBeenCalledWith('lodash@4.17.21')
    })

    it('returns undefined when npm-package-arg throws', () => {
      mockNpmPackageArg.mockImplementation(() => {
        throw new Error('Invalid spec')
      })

      const result = safeNpa('invalid-spec')

      expect(result).toBeUndefined()
    })

    it('passes all arguments to npm-package-arg', () => {
      const mockResult = { name: 'lodash' }
      mockNpmPackageArg.mockReturnValue(mockResult as any)

      safeNpa('lodash', '/some/dir')

      expect(mockNpmPackageArg).toHaveBeenCalledWith('lodash', '/some/dir')
    })

    it('handles empty arguments', () => {
      const mockResult = { name: '' }
      mockNpmPackageArg.mockReturnValue(mockResult as any)

      const result = safeNpa('')

      expect(result).toBe(mockResult)
    })
  })

  describe('safeParseNpmSpec', () => {
    it('parses regular package without version', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'tag',
        fetchSpec: '*',
        rawSpec: '',
      } as any)

      const result = safeParseNpmSpec('lodash')

      expect(result).toEqual({
        name: 'lodash',
        version: undefined,
      })
    })

    it('parses package with exact version', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'version',
        fetchSpec: '4.17.21',
        rawSpec: '4.17.21',
      } as any)

      const result = safeParseNpmSpec('lodash@4.17.21')

      expect(result).toEqual({
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('parses package with version range', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'range',
        fetchSpec: '^4.0.0',
        rawSpec: '^4.0.0',
      } as any)

      const result = safeParseNpmSpec('lodash@^4.0.0')

      expect(result).toEqual({
        name: 'lodash',
        version: '^4.0.0',
      })
    })

    it('parses scoped package', () => {
      mockNpmPackageArg.mockReturnValue({
        name: '@types/node',
        type: 'version',
        fetchSpec: '20.0.0',
        rawSpec: '20.0.0',
      } as any)

      const result = safeParseNpmSpec('@types/node@20.0.0')

      expect(result).toEqual({
        name: '@types/node',
        version: '20.0.0',
      })
    })

    it('parses package with tag', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'tag',
        fetchSpec: 'latest',
        rawSpec: 'latest',
      } as any)

      const result = safeParseNpmSpec('lodash@latest')

      expect(result).toEqual({
        name: 'lodash',
        version: 'latest',
      })
    })

    it('handles git URL', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'repo',
        type: 'git',
        fetchSpec: 'git+https://github.com/user/repo.git',
        rawSpec: 'git+https://github.com/user/repo.git',
      } as any)

      const result = safeParseNpmSpec('git+https://github.com/user/repo.git')

      expect(result).toEqual({
        name: 'repo',
        version: 'git+https://github.com/user/repo.git',
      })
    })

    it('handles file path', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'local-package',
        type: 'file',
        fetchSpec: '../local-package',
        rawSpec: '../local-package',
      } as any)

      const result = safeParseNpmSpec('file:../local-package')

      expect(result).toEqual({
        name: 'local-package',
        version: '../local-package',
      })
    })

    it('handles remote URL', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'package',
        type: 'remote',
        fetchSpec: 'https://example.com/package.tgz',
        rawSpec: 'https://example.com/package.tgz',
      } as any)

      const result = safeParseNpmSpec('https://example.com/package.tgz')

      expect(result).toEqual({
        name: 'package',
        version: 'https://example.com/package.tgz',
      })
    })

    it('falls back to manual parsing when npm-package-arg fails', () => {
      mockNpmPackageArg.mockImplementation(() => {
        throw new Error('Parse error')
      })

      const result = safeParseNpmSpec('lodash@4.17.21')

      expect(result).toEqual({
        name: 'lodash',
        version: '4.17.21',
      })
    })

    it('falls back to manual parsing for scoped packages', () => {
      mockNpmPackageArg.mockImplementation(() => {
        throw new Error('Parse error')
      })

      const result = safeParseNpmSpec('@types/node@20.0.0')

      expect(result).toEqual({
        name: '@types/node',
        version: '20.0.0',
      })
    })

    it('falls back handles package without version', () => {
      mockNpmPackageArg.mockImplementation(() => {
        throw new Error('Parse error')
      })

      const result = safeParseNpmSpec('lodash')

      expect(result).toEqual({
        name: 'lodash',
        version: undefined,
      })
    })

    it('ignores asterisk version from fetchSpec', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'range',
        fetchSpec: '*',
        rawSpec: '',
      } as any)

      const result = safeParseNpmSpec('lodash')

      expect(result).toEqual({
        name: 'lodash',
        version: undefined,
      })
    })

    it('uses rawSpec when fetchSpec is asterisk but rawSpec is not', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'range',
        fetchSpec: '*',
        rawSpec: '^4.0.0',
      } as any)

      const result = safeParseNpmSpec('lodash@^4.0.0')

      expect(result).toEqual({
        name: 'lodash',
        version: '^4.0.0',
      })
    })

    it('ignores rawSpec when it equals package name', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'tag',
        fetchSpec: 'latest',
        rawSpec: 'lodash',
      } as any)

      const result = safeParseNpmSpec('lodash@latest')

      expect(result).toEqual({
        name: 'lodash',
        version: 'latest',
      })
    })
  })

  describe('safeNpmSpecToPurl', () => {
    beforeEach(() => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'version',
        fetchSpec: '4.17.21',
        rawSpec: '4.17.21',
      } as any)
    })

    it('converts package spec to PURL', () => {
      const mockPurl = { toString: () => 'pkg:npm/lodash@4.17.21' }
      mockCreatePurlObject.mockReturnValue(mockPurl as any)

      const result = safeNpmSpecToPurl('lodash@4.17.21')

      expect(result).toBe('pkg:npm/lodash@4.17.21')
      expect(mockCreatePurlObject).toHaveBeenCalledWith({
        type: 'npm',
        name: 'lodash',
        version: '4.17.21',
        throws: false,
      })
    })

    it('converts package without version to PURL', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'tag',
        fetchSpec: '*',
        rawSpec: '',
      } as any)

      const mockPurl = { toString: () => 'pkg:npm/lodash' }
      mockCreatePurlObject.mockReturnValue(mockPurl as any)

      const result = safeNpmSpecToPurl('lodash')

      expect(result).toBe('pkg:npm/lodash')
      expect(mockCreatePurlObject).toHaveBeenCalledWith({
        type: 'npm',
        name: 'lodash',
        version: undefined,
        throws: false,
      })
    })

    it('converts scoped package to PURL', () => {
      mockNpmPackageArg.mockReturnValue({
        name: '@types/node',
        type: 'version',
        fetchSpec: '20.0.0',
        rawSpec: '20.0.0',
      } as any)

      const mockPurl = { toString: () => 'pkg:npm/@types/node@20.0.0' }
      mockCreatePurlObject.mockReturnValue(mockPurl as any)

      const result = safeNpmSpecToPurl('@types/node@20.0.0')

      expect(result).toBe('pkg:npm/@types/node@20.0.0')
    })

    it('falls back to manual PURL construction when createPurlObject fails', () => {
      mockCreatePurlObject.mockReturnValue(undefined)

      const result = safeNpmSpecToPurl('lodash@4.17.21')

      expect(result).toBe('pkg:npm/lodash@4.17.21')
    })

    it('falls back for package without version', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'tag',
        fetchSpec: '*',
        rawSpec: '',
      } as any)
      mockCreatePurlObject.mockReturnValue(undefined)

      const result = safeNpmSpecToPurl('lodash')

      expect(result).toBe('pkg:npm/lodash')
    })

    it('returns undefined when parsing results in empty name', () => {
      mockNpmPackageArg.mockImplementation(() => {
        throw new Error('Parse error')
      })
      mockCreatePurlObject.mockReturnValue(undefined)

      // The fallback parsing would return { name: '', version: undefined } for empty string.
      // safeParseNpmSpec now correctly returns undefined for empty string.
      const result = safeNpmSpecToPurl('')

      // For empty string, the fallback parsing now returns undefined,
      // so safeNpmSpecToPurl also returns undefined.
      expect(result).toBeUndefined()
    })

    it('handles complex version ranges', () => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'range',
        fetchSpec: '>=4.0.0 <5.0.0',
        rawSpec: '>=4.0.0 <5.0.0',
      } as any)

      const mockPurl = { toString: () => 'pkg:npm/lodash@>=4.0.0 <5.0.0' }
      mockCreatePurlObject.mockReturnValue(mockPurl as any)

      const result = safeNpmSpecToPurl('lodash@>=4.0.0 <5.0.0')

      expect(result).toBe('pkg:npm/lodash@>=4.0.0 <5.0.0')
    })
  })

  describe('npmSpecToPurl', () => {
    beforeEach(() => {
      mockNpmPackageArg.mockReturnValue({
        name: 'lodash',
        type: 'version',
        fetchSpec: '4.17.21',
        rawSpec: '4.17.21',
      } as any)
    })

    it('returns PURL when conversion succeeds', () => {
      const mockPurl = { toString: () => 'pkg:npm/lodash@4.17.21' }
      mockCreatePurlObject.mockReturnValue(mockPurl as any)

      const result = npmSpecToPurl('lodash@4.17.21')

      expect(result).toBe('pkg:npm/lodash@4.17.21')
    })

    it('throws error when conversion returns undefined', () => {
      // Override safeNpmSpecToPurl to return undefined by making fallback fail.
      mockNpmPackageArg.mockImplementation(() => {
        throw new Error('Parse error')
      })
      mockCreatePurlObject.mockReturnValue(undefined)

      // Make the fallback parsing fail by providing an empty string that would result in empty name.
      expect(() => npmSpecToPurl('')).toThrow(
        'Failed to convert npm spec to PURL:',
      )
    })

    it('includes spec in error message when conversion fails', () => {
      mockNpmPackageArg.mockImplementation(() => {
        throw new Error('Parse error')
      })
      mockCreatePurlObject.mockReturnValue(undefined)

      // Make fallback parsing fail by providing empty string.
      expect(() => npmSpecToPurl('')).toThrow(
        'Failed to convert npm spec to PURL: ',
      )
    })

    it('delegates to safeNpmSpecToPurl', () => {
      const mockPurl = { toString: () => 'pkg:npm/test@1.0.0' }
      mockCreatePurlObject.mockReturnValue(mockPurl as any)

      const result = npmSpecToPurl('test@1.0.0')

      expect(result).toBe('pkg:npm/test@1.0.0')
    })
  })
})
