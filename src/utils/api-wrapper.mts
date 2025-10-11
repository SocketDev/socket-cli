/** @fileoverview Simplified API wrapper to DRY out repetitive fetch-*.mts files */

import { withSdk } from './sdk.mts'
import type { BaseFetchOptions, CResult } from '../types.mts'
import type { SocketSdk, SocketSdkSuccessResult } from '@socketsecurity/sdk'

/**
 * Generic API call wrapper that eliminates the need for separate fetch-*.mts files
 * for simple SDK method calls.
 */
export async function apiCall<T extends keyof SocketSdk>(
  method: T,
  args: Parameters<SocketSdk[T]>,
  description: string,
  options?: BaseFetchOptions,
): Promise<CResult<SocketSdkSuccessResult<T>['data']>> {
  return await withSdk(
    sdk => (sdk[method] as any)(...args),
    description,
    options,
  )
}

/**
 * Simplified repository API calls
 */
export const repoApi = {
  list: (orgSlug: string, params: any, options?: BaseFetchOptions) =>
    apiCall(
      'getOrgRepoList',
      [orgSlug, params],
      'list of repositories',
      options,
    ),

  create: (orgSlug: string, params: any, options?: BaseFetchOptions) =>
    apiCall(
      'createOrgRepo',
      [orgSlug, params],
      'to create a repository',
      options,
    ),

  delete: (orgSlug: string, repoName: string, options?: BaseFetchOptions) =>
    apiCall(
      'deleteOrgRepo',
      [orgSlug, repoName],
      'to delete a repository',
      options,
    ),

  update: (
    orgSlug: string,
    repoName: string,
    params: any,
    options?: BaseFetchOptions,
  ) =>
    apiCall(
      'updateOrgRepo',
      [orgSlug, repoName, params],
      'to update a repository',
      options,
    ),

  view: (orgSlug: string, repoName: string, options?: BaseFetchOptions) =>
    apiCall('getOrgRepo', [orgSlug, repoName], 'repository', options),
}

/**
 * Simplified organization API calls
 */
export const orgApi = {
  list: (options?: BaseFetchOptions) =>
    apiCall('getOrganizations', [], 'list of organizations', options),

  dependencies: (orgSlug: string, params: any, options?: BaseFetchOptions) =>
    apiCall('searchDependencies', [orgSlug, params], 'dependencies', options),

  quota: (orgSlug: string, options?: BaseFetchOptions) =>
    apiCall('getOrganizationQuota', [orgSlug], 'organization quota', options),

  securityPolicy: (orgSlug: string, options?: BaseFetchOptions) =>
    apiCall(
      'getOrganizationSecurityPolicy',
      [orgSlug],
      'security policy',
      options,
    ),

  licensePolicy: (orgSlug: string, options?: BaseFetchOptions) =>
    apiCall(
      'getOrganizationLicensePolicy',
      [orgSlug],
      'license policy',
      options,
    ),
}

/**
 * Simplified package API calls
 */
export const packageApi = {
  score: (
    ecosystem: string,
    name: string,
    version: string,
    options?: BaseFetchOptions,
  ) =>
    apiCall(
      'getPackageScore',
      [ecosystem, name, version],
      'package score',
      options,
    ),

  issues: (
    ecosystem: string,
    name: string,
    version: string,
    options?: BaseFetchOptions,
  ) =>
    apiCall(
      'getPackageIssues',
      [ecosystem, name, version],
      'package issues',
      options,
    ),
}

/**
 * Simplified scan API calls
 */
export const scanApi = {
  create: (orgSlug: string, params: any, options?: BaseFetchOptions) =>
    apiCall('createOrgScan', [orgSlug, params], 'to create a scan', options),

  list: (orgSlug: string, params: any, options?: BaseFetchOptions) =>
    apiCall('getOrgScanList', [orgSlug, params], 'list of scans', options),

  delete: (orgSlug: string, scanId: string, options?: BaseFetchOptions) =>
    apiCall('deleteOrgScan', [orgSlug, scanId], 'to delete a scan', options),

  view: (orgSlug: string, scanId: string, options?: BaseFetchOptions) =>
    apiCall('getOrgScan', [orgSlug, scanId], 'scan details', options),
}
