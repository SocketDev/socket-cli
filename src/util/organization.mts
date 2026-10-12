import type { Organizations } from '../command/organization/organization-list-data.mts'

export function getEnterpriseOrgs(orgs: Organizations): Organizations {
  return orgs.filter(o => o.plan.includes('enterprise'))
}

export function getOrgSlugs(orgs: Organizations): string[] {
  return orgs.map(o => o.slug)
}

export function hasEnterpriseOrgPlan(orgs: Organizations): boolean {
  return orgs.some(o => o.plan.includes('enterprise'))
}
