/**
 * Unit tests for organization utilities.
 *
 * Purpose:
 * Tests the organization helper functions.
 *
 * Test Coverage:
 * - getEnterpriseOrgs filtering
 * - getOrgSlugs extraction
 * - hasEnterpriseOrgPlan check
 *
 * Related Files:
 * - utils/organization.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  getEnterpriseOrgs,
  getOrgSlugs,
  hasEnterpriseOrgPlan,
} from '../../../src/utils/organization.mts'

describe('organization utilities', () => {
  const mockOrgs = [
    { slug: 'free-org', name: 'Free Org', plan: 'free' },
    { slug: 'enterprise-org', name: 'Enterprise Org', plan: 'enterprise' },
    { slug: 'pro-org', name: 'Pro Org', plan: 'pro' },
    { slug: 'enterprise-plus', name: 'Enterprise Plus', plan: 'enterprise-plus' },
  ] as any

  describe('getEnterpriseOrgs', () => {
    it('returns only enterprise plan organizations', () => {
      const result = getEnterpriseOrgs(mockOrgs)

      expect(result).toHaveLength(2)
      expect(result.map(o => o.slug)).toEqual([
        'enterprise-org',
        'enterprise-plus',
      ])
    })

    it('returns empty array when no enterprise orgs', () => {
      const nonEnterpriseOrgs = [
        { slug: 'free-org', plan: 'free' },
        { slug: 'pro-org', plan: 'pro' },
      ] as any

      const result = getEnterpriseOrgs(nonEnterpriseOrgs)

      expect(result).toHaveLength(0)
    })

    it('returns empty array for empty input', () => {
      const result = getEnterpriseOrgs([])

      expect(result).toHaveLength(0)
    })
  })

  describe('getOrgSlugs', () => {
    it('extracts slugs from organizations', () => {
      const result = getOrgSlugs(mockOrgs)

      expect(result).toEqual([
        'free-org',
        'enterprise-org',
        'pro-org',
        'enterprise-plus',
      ])
    })

    it('returns empty array for empty input', () => {
      const result = getOrgSlugs([])

      expect(result).toEqual([])
    })

    it('handles single organization', () => {
      const result = getOrgSlugs([{ slug: 'single-org', plan: 'pro' }] as any)

      expect(result).toEqual(['single-org'])
    })
  })

  describe('hasEnterpriseOrgPlan', () => {
    it('returns true when enterprise org exists', () => {
      const result = hasEnterpriseOrgPlan(mockOrgs)

      expect(result).toBe(true)
    })

    it('returns false when no enterprise org exists', () => {
      const nonEnterpriseOrgs = [
        { slug: 'free-org', plan: 'free' },
        { slug: 'pro-org', plan: 'pro' },
      ] as any

      const result = hasEnterpriseOrgPlan(nonEnterpriseOrgs)

      expect(result).toBe(false)
    })

    it('returns false for empty array', () => {
      const result = hasEnterpriseOrgPlan([])

      expect(result).toBe(false)
    })

    it('matches partial enterprise plan names', () => {
      const orgsWithEnterprisePlus = [
        { slug: 'org1', plan: 'enterprise-plus' },
      ] as any

      const result = hasEnterpriseOrgPlan(orgsWithEnterprisePlus)

      expect(result).toBe(true)
    })
  })
})
