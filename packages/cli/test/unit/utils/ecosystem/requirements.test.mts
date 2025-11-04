import { describe, expect, it, vi } from 'vitest'

import {
  getRequirements,
  getRequirementsKey,
} from '../../../../src/utils/ecosystem/requirements.mts'

// Mock the requirements.json module.
vi.mock('../../../../src/utils/ecosystem/requirements.json', () => ({
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
    it('converts basic command path to key', () => {
      expect(getRequirementsKey('socket scan')).toBe('scan')
      expect(getRequirementsKey('socket organization')).toBe('organization')
    })

    it('converts nested command path to key with colons', () => {
      expect(getRequirementsKey('socket scan create')).toBe('scan:create')
      expect(getRequirementsKey('socket organization view')).toBe(
        'organization:view',
      )
    })

    it('handles multiple spaces', () => {
      expect(getRequirementsKey('socket  scan  create')).toBe(':scan:create')
      expect(getRequirementsKey('socket   organization   view')).toBe(
        ':organization:view',
      )
    })

    it('handles path with colon separator', () => {
      expect(getRequirementsKey('socket: scan')).toBe(':scan')
      expect(getRequirementsKey('socket: scan create')).toBe(':scan:create')
    })

    it('handles path without socket prefix', () => {
      expect(getRequirementsKey('scan create')).toBe('scan:create')
      expect(getRequirementsKey('organization view')).toBe('organization:view')
    })

    it('handles single command', () => {
      expect(getRequirementsKey('login')).toBe('login')
      expect(getRequirementsKey('logout')).toBe('logout')
    })

    it('handles empty string', () => {
      expect(getRequirementsKey('')).toBe('')
    })

    it('handles deeply nested commands', () => {
      expect(getRequirementsKey('socket repos create test')).toBe(
        'repos:create:test',
      )
      expect(getRequirementsKey('socket organization member add')).toBe(
        'organization:member:add',
      )
    })

    it('preserves non-space special characters', () => {
      expect(getRequirementsKey('socket scan-create')).toBe('scan-create')
      expect(getRequirementsKey('socket org_view')).toBe('org_view')
    })
  })
})
