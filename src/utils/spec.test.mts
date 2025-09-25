import { beforeEach, describe, expect, it, vi } from 'vitest'

import { idToNpmPurl, idToPurl, resolvePackageVersion } from './spec.mts'

// Mock semver module.
vi.mock('semver', () => ({
  default: {
    coerce: vi.fn(),
  },
}))

// Mock pnpm utilities.
vi.mock('./pnpm.mts', () => ({
  stripPnpmPeerSuffix: vi.fn(v => v.replace(/_.*$/, '')),
}))

describe('spec utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('idToNpmPurl', () => {
    it('converts package ID to npm PURL', () => {
      expect(idToNpmPurl('express@4.18.0')).toBe('pkg:npm/express@4.18.0')
      expect(idToNpmPurl('lodash@4.17.21')).toBe('pkg:npm/lodash@4.17.21')
    })

    it('handles scoped packages', () => {
      expect(idToNpmPurl('@babel/core@7.0.0')).toBe('pkg:npm/@babel/core@7.0.0')
      expect(idToNpmPurl('@types/node@18.0.0')).toBe(
        'pkg:npm/@types/node@18.0.0',
      )
    })

    it('handles packages without versions', () => {
      expect(idToNpmPurl('express')).toBe('pkg:npm/express')
      expect(idToNpmPurl('@babel/core')).toBe('pkg:npm/@babel/core')
    })
  })

  describe('idToPurl', () => {
    it('converts package ID to PURL with specified type', () => {
      expect(idToPurl('flask==2.0.0', 'pypi')).toBe('pkg:pypi/flask==2.0.0')
      expect(idToPurl('gem@1.0.0', 'gem')).toBe('pkg:gem/gem@1.0.0')
      expect(idToPurl('org.apache:commons@3.0', 'maven')).toBe(
        'pkg:maven/org.apache:commons@3.0',
      )
    })

    it('handles npm type', () => {
      expect(idToPurl('express@4.18.0', 'npm')).toBe('pkg:npm/express@4.18.0')
    })

    it('handles empty type', () => {
      expect(idToPurl('package@1.0.0', '')).toBe('pkg:/package@1.0.0')
    })
  })

  describe('resolvePackageVersion', () => {
    it('returns empty string when no version', () => {
      const purlObj = {
        type: 'npm',
        name: 'express',
        version: undefined,
      } as any

      const result = resolvePackageVersion(purlObj)
      expect(result).toBe('')
    })

    it('coerces npm package versions', async () => {
      const semver = (await import('semver')).default
      vi.mocked(semver.coerce).mockReturnValue({ version: '4.18.0' } as any)

      const purlObj = {
        type: 'npm',
        name: 'express',
        version: '4.18.0_peer@1.0.0',
      } as any

      const result = resolvePackageVersion(purlObj)
      expect(result).toBe('4.18.0')

      const { stripPnpmPeerSuffix } = vi.mocked(await import('./pnpm.mts'))
      expect(stripPnpmPeerSuffix).toHaveBeenCalledWith('4.18.0_peer@1.0.0')
      expect(semver.coerce).toHaveBeenCalledWith('4.18.0')
    })

    it('coerces non-npm package versions without stripping', async () => {
      const semver = (await import('semver')).default
      vi.mocked(semver.coerce).mockReturnValue({ version: '2.0.0' } as any)

      const purlObj = {
        type: 'pypi',
        name: 'flask',
        version: '2.0.0',
      } as any

      const result = resolvePackageVersion(purlObj)
      expect(result).toBe('2.0.0')

      const { stripPnpmPeerSuffix } = vi.mocked(await import('./pnpm.mts'))
      expect(stripPnpmPeerSuffix).not.toHaveBeenCalled()
      expect(semver.coerce).toHaveBeenCalledWith('2.0.0')
    })

    it('returns empty string when coerce returns null', async () => {
      const semver = (await import('semver')).default
      vi.mocked(semver.coerce).mockReturnValue(null)

      const purlObj = {
        type: 'npm',
        name: 'invalid',
        version: 'not-a-version',
      } as any

      const result = resolvePackageVersion(purlObj)
      expect(result).toBe('')
    })

    it('handles complex npm versions with peer suffixes', async () => {
      const semver = (await import('semver')).default
      vi.mocked(semver.coerce).mockReturnValue({ version: '18.2.0' } as any)

      const purlObj = {
        type: 'npm',
        name: 'react',
        version: '18.2.0_react-dom@18.2.0',
      } as any

      const result = resolvePackageVersion(purlObj)
      expect(result).toBe('18.2.0')

      const { stripPnpmPeerSuffix } = vi.mocked(await import('./pnpm.mts'))
      expect(stripPnpmPeerSuffix).toHaveBeenCalledWith(
        '18.2.0_react-dom@18.2.0',
      )
    })
  })
})
