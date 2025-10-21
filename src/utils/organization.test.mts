import { describe, expect, it } from 'vitest'
import type { Organizations } from '../commands/organization/fetch-organization-list.mts'
import {
  getEnterpriseOrgs,
  getOrgSlugs,
  hasEnterpriseOrgPlan,
} from './organization.mts'

describe('organization utilities', () => {
  const mockOrgs: Organizations = [
    {
      id: '1',
      name: 'Free Org',
      slug: 'free-org',
      plan: 'free',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    },
    {
      id: '2',
      name: 'Enterprise Org 1',
      slug: 'enterprise-org-1',
      plan: 'enterprise',
      createdAt: '2024-01-02',
      updatedAt: '2024-01-02',
    },
    {
      id: '3',
      name: 'Pro Org',
      slug: 'pro-org',
      plan: 'pro',
      createdAt: '2024-01-03',
      updatedAt: '2024-01-03',
    },
    {
      id: '4',
      name: 'Enterprise Org 2',
      slug: 'enterprise-org-2',
      plan: 'enterprise',
      createdAt: '2024-01-04',
      updatedAt: '2024-01-04',
    },
  ] as Organizations

  describe('getEnterpriseOrgs', () => {
    it('filters out only enterprise organizations', () => {
      const result = getEnterpriseOrgs(mockOrgs)

      expect(result).toHaveLength(2)
      expect(result[0].slug).toBe('enterprise-org-1')
      expect(result[1].slug).toBe('enterprise-org-2')
      expect(result.every(org => org.plan === 'enterprise')).toBe(true)
    })

    it('returns empty array when no enterprise orgs', () => {
      const nonEnterpriseOrgs = [
        {
          id: '1',
          name: 'Free Org',
          slug: 'free-org',
          plan: 'free',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
        {
          id: '2',
          name: 'Pro Org',
          slug: 'pro-org',
          plan: 'pro',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ] as Organizations

      const result = getEnterpriseOrgs(nonEnterpriseOrgs)
      expect(result).toEqual([])
    })

    it('handles empty array', () => {
      const result = getEnterpriseOrgs([])
      expect(result).toEqual([])
    })
  })

  describe('getOrgSlugs', () => {
    it('extracts slugs from all organizations', () => {
      const result = getOrgSlugs(mockOrgs)

      expect(result).toEqual([
        'free-org',
        'enterprise-org-1',
        'pro-org',
        'enterprise-org-2',
      ])
    })

    it('returns empty array for empty organizations', () => {
      const result = getOrgSlugs([])
      expect(result).toEqual([])
    })

    it('maintains order of organizations', () => {
      const orgs = [
        { slug: 'z-org' },
        { slug: 'a-org' },
        { slug: 'm-org' },
      ] as Organizations

      const result = getOrgSlugs(orgs)
      expect(result).toEqual(['z-org', 'a-org', 'm-org'])
    })
  })

  describe('hasEnterpriseOrgPlan', () => {
    it('returns true when enterprise org exists', () => {
      const result = hasEnterpriseOrgPlan(mockOrgs)
      expect(result).toBe(true)
    })

    it('returns false when no enterprise org exists', () => {
      const nonEnterpriseOrgs = [
        {
          id: '1',
          name: 'Free Org',
          slug: 'free-org',
          plan: 'free',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
        {
          id: '2',
          name: 'Pro Org',
          slug: 'pro-org',
          plan: 'pro',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ] as Organizations

      const result = hasEnterpriseOrgPlan(nonEnterpriseOrgs)
      expect(result).toBe(false)
    })

    it('returns false for empty array', () => {
      const result = hasEnterpriseOrgPlan([])
      expect(result).toBe(false)
    })

    it('returns true with single enterprise org', () => {
      const singleEnterprise = [
        {
          id: '1',
          name: 'Enterprise Org',
          slug: 'enterprise-org',
          plan: 'enterprise',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ] as Organizations

      const result = hasEnterpriseOrgPlan(singleEnterprise)
      expect(result).toBe(true)
    })
  })
})
