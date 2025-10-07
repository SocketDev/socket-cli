import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getRequirements, getRequirementsKey } from './requirements.mts'

// Mock the requirements.json module.
vi.mock('../../requirements.json', () => ({
  default: {
    api: {
      'scan:create': {
        quota: 10,
        permissions: ['create', 'scan'],
      },
      'organization:view': {
        permissions: ['read'],
      },
    },
  },
}))

describe('requirements utilities', () => {
  describe('getRequirements', () => {
    it('loads requirements configuration', () => {
      const requirements = getRequirements()
      expect(requirements).toBeDefined()
      expect(requirements).toHaveProperty('api')
    })

    it('caches requirements after first load', () => {
      const requirements1 = getRequirements()
      const requirements2 = getRequirements()
      expect(requirements1).toBe(requirements2)
    })
  })

  describe('getRequirementsKey', () => {
    it('converts basic command path to SDK method names', () => {
      expect(getRequirementsKey('socket scan')).toEqual(['scan'])
      expect(getRequirementsKey('socket organization')).toEqual([
        'organization',
      ])
    })

    it('converts nested command path to SDK method names', () => {
      expect(getRequirementsKey('socket scan create')).toEqual([
        'createOrgFullScan',
      ])
      expect(getRequirementsKey('socket organization list')).toEqual([
        'getOrganizations',
      ])
    })

    it('handles login command', () => {
      expect(getRequirementsKey('login')).toEqual(['getApi'])
      expect(getRequirementsKey('socket login')).toEqual(['getApi'])
    })

    it('handles threat-feed command', () => {
      expect(getRequirementsKey('threat-feed')).toEqual(['getApi'])
      expect(getRequirementsKey('socket threat-feed')).toEqual(['getApi'])
    })

    it('handles unknown commands by returning array with normalized key', () => {
      expect(getRequirementsKey('socket unknown')).toEqual(['unknown'])
      expect(getRequirementsKey('unknown command')).toEqual(['unknown:command'])
    })

    it('handles empty string', () => {
      expect(getRequirementsKey('')).toEqual([''])
    })

    it('returns array for scan report with multiple SDK methods', () => {
      const result = getRequirementsKey('socket scan report')
      expect(Array.isArray(result)).toBe(true)
      expect(result).toEqual(['getOrgFullScanMetadata', 'getOrgSecurityPolicy'])
    })
  })
})
