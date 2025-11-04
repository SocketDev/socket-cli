import { describe, expect, it, vi } from 'vitest'

import { safeNpa } from '../../../../src/utils/npm/package-arg.mts'

// Mock npm-package-arg.
const mockDefault = vi.hoisted(() => vi.fn())

vi.mock('npm-package-arg', () => ({
  default: mockDefault,
}))

describe('npm-package-arg utilities', () => {
  describe('safeNpa', () => {
    it('returns parsed package spec when valid', async () => {
      const npmPackageArg = (await import('npm-package-arg')).default
      const mockNpa = vi.mocked(npmPackageArg)

      const mockResult = {
        type: 'registry',
        name: 'lodash',
        rawSpec: '4.17.21',
        registry: true,
      }
      mockNpa.mockReturnValue(mockResult)

      const result = safeNpa('lodash@4.17.21')

      expect(result).toEqual(mockResult)
      expect(mockNpa).toHaveBeenCalledWith('lodash@4.17.21')
    })

    it('passes through all arguments to npm-package-arg', async () => {
      const npmPackageArg = (await import('npm-package-arg')).default
      const mockNpa = vi.mocked(npmPackageArg)

      const mockResult = {
        type: 'registry',
        name: '@scope/package',
        rawSpec: '1.0.0',
      }
      mockNpa.mockReturnValue(mockResult)

      const result = safeNpa('@scope/package@1.0.0', '/some/path')

      expect(result).toEqual(mockResult)
      expect(mockNpa).toHaveBeenCalledWith('@scope/package@1.0.0', '/some/path')
    })

    it('returns undefined when npm-package-arg throws', async () => {
      const npmPackageArg = (await import('npm-package-arg')).default
      const mockNpa = vi.mocked(npmPackageArg)

      mockNpa.mockImplementation(() => {
        throw new Error('Invalid package spec')
      })

      const result = safeNpa('invalid::spec')

      expect(result).toBeUndefined()
      expect(mockNpa).toHaveBeenCalledWith('invalid::spec')
    })

    it('handles file spec', async () => {
      const npmPackageArg = (await import('npm-package-arg')).default
      const mockNpa = vi.mocked(npmPackageArg)

      const mockResult = {
        type: 'file',
        name: null,
        spec: 'file:../local-package',
      }
      mockNpa.mockReturnValue(mockResult)

      const result = safeNpa('file:../local-package')

      expect(result).toEqual(mockResult)
    })

    it('handles git spec', async () => {
      const npmPackageArg = (await import('npm-package-arg')).default
      const mockNpa = vi.mocked(npmPackageArg)

      const mockResult = {
        type: 'git',
        name: null,
        spec: 'git+https://github.com/user/repo.git',
      }
      mockNpa.mockReturnValue(mockResult)

      const result = safeNpa('git+https://github.com/user/repo.git')

      expect(result).toEqual(mockResult)
    })

    it('handles tag spec', async () => {
      const npmPackageArg = (await import('npm-package-arg')).default
      const mockNpa = vi.mocked(npmPackageArg)

      const mockResult = {
        type: 'tag',
        name: 'express',
        rawSpec: 'latest',
      }
      mockNpa.mockReturnValue(mockResult)

      const result = safeNpa('express@latest')

      expect(result).toEqual(mockResult)
    })

    it('handles range spec', async () => {
      const npmPackageArg = (await import('npm-package-arg')).default
      const mockNpa = vi.mocked(npmPackageArg)

      const mockResult = {
        type: 'range',
        name: 'react',
        rawSpec: '^18.0.0',
      }
      mockNpa.mockReturnValue(mockResult)

      const result = safeNpa('react@^18.0.0')

      expect(result).toEqual(mockResult)
    })

    it('handles alias spec', async () => {
      const npmPackageArg = (await import('npm-package-arg')).default
      const mockNpa = vi.mocked(npmPackageArg)

      const mockResult = {
        type: 'alias',
        name: 'my-lodash',
        subSpec: {
          type: 'registry',
          name: 'lodash',
        },
      }
      mockNpa.mockReturnValue(mockResult)

      const result = safeNpa('my-lodash@npm:lodash@4.17.21')

      expect(result).toEqual(mockResult)
    })

    it('returns undefined for undefined input', async () => {
      const npmPackageArg = (await import('npm-package-arg')).default
      const mockNpa = vi.mocked(npmPackageArg)

      mockNpa.mockImplementation(() => {
        throw new TypeError('Cannot read property of undefined')
      })

      const result = safeNpa(undefined as any)

      expect(result).toBeUndefined()
    })

    it('returns undefined for null input', async () => {
      const npmPackageArg = (await import('npm-package-arg')).default
      const mockNpa = vi.mocked(npmPackageArg)

      mockNpa.mockImplementation(() => {
        throw new TypeError('Cannot read property of null')
      })

      const result = safeNpa(null as any)

      expect(result).toBeUndefined()
    })
  })
})
