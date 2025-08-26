import type {
  EnterpriseOrganizations,
  Organizations,
} from '../commands/organization/fetch-organization-list.mts'

export function getEnterpriseOrgs(
  orgs: Organizations,
): EnterpriseOrganizations {
  return orgs.filter(o => o.plan === 'enterprise') as EnterpriseOrganizations
}

export function getOrgSlugs(orgs: Organizations): string[] {
  return orgs.map(o => o.slug)
}

export function hasOrgEnterprisePlan(orgs: Organizations): boolean {
  return orgs.some(o => o.plan === 'enterprise')
}
