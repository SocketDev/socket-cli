/** @fileoverview Simplified API wrapper to DRY out repetitive fetch-*.mts files */

import { handleApiCall } from './api.mts'
import { setupSdk } from './sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdk } from '@socketsecurity/sdk'

/**
 * Generic API call wrapper that eliminates the need for separate fetch-*.mts files
 * for simple SDK method calls.
 */
export async function apiCall<T extends keyof SocketSdk>(
  method: T,
  args: Parameters<SocketSdk[T]>,
  description: string,
  options?: BaseFetchOptions,
): Promise<CResult<any>> {
  const sdkResult = await setupSdk(options?.sdkOpts)
  if (!sdkResult.ok) {
    return sdkResult
  }
  const sdk = sdkResult.data

  return await handleApiCall((sdk[method] as any)(...args), { description })
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
    apiCall('listOrganizations', [], 'list of organizations', options),

  dependencies: (_orgSlug: string, params: any, options?: BaseFetchOptions) =>
    apiCall('searchDependencies', [params], 'dependencies', options),

  quota: (_orgSlug: string, options?: BaseFetchOptions) =>
    apiCall('getQuota' as keyof SocketSdk, [], 'organization quota', options),

  securityPolicy: (orgSlug: string, options?: BaseFetchOptions) =>
    apiCall('getOrgSecurityPolicy', [orgSlug], 'security policy', options),

  licensePolicy: (orgSlug: string, options?: BaseFetchOptions) =>
    apiCall('getOrgLicensePolicy', [orgSlug], 'license policy', options),
}

/**
 * Simplified package API calls
 */
export const packageApi = {
  score: (
    _ecosystem: string,
    name: string,
    version: string,
    options?: BaseFetchOptions,
  ) =>
    apiCall(
      'getScoreByNpmPackage' as keyof SocketSdk,
      [name, version],
      'package score',
      options,
    ),

  issues: (
    _ecosystem: string,
    name: string,
    version: string,
    options?: BaseFetchOptions,
  ) =>
    apiCall(
      'getIssuesByNpmPackage' as keyof SocketSdk,
      [name, version],
      'package issues',
      options,
    ),
}

/**
 * Simplified scan API calls
 */
export const scanApi = {
  create: (orgSlug: string, params: any, options?: BaseFetchOptions) =>
    apiCall(
      'createFullScan' as keyof SocketSdk,
      [orgSlug, params],
      'to create a scan',
      options,
    ),

  list: (orgSlug: string, params: any, options?: BaseFetchOptions) =>
    apiCall(
      'getOrgFullScanList' as keyof SocketSdk,
      [orgSlug, params],
      'list of scans',
      options,
    ),

  delete: (orgSlug: string, scanId: string, options?: BaseFetchOptions) =>
    apiCall(
      'deleteOrgFullScan' as keyof SocketSdk,
      [orgSlug, scanId],
      'to delete a scan',
      options,
    ),

  view: (orgSlug: string, scanId: string, options?: BaseFetchOptions) =>
    apiCall(
      'getOrgFullScan' as keyof SocketSdk,
      [orgSlug, scanId],
      'scan details',
      options,
    ),
}
