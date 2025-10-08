/** @fileoverview Simplified API wrapper to DRY out repetitive fetch-*.mts files */

import { withCache } from './offline-cache.mts'
import { withSdk } from './sdk.mts'

import type { BaseFetchOptions, CResult } from '../types.mts'
import type { SocketSdk, SocketSdkSuccessResult } from '@socketsecurity/sdk'

export interface ApiCallOptions extends BaseFetchOptions {
  cache?: boolean
  cacheTtl?: number
  cacheNamespace?: string
}

/**
 * Generic API call wrapper that eliminates the need for separate fetch-*.mts files
 * for simple SDK method calls.
 */
export async function apiCall<T extends keyof SocketSdk>(
  method: T,
  args: Parameters<SocketSdk[T]>,
  description: string,
  options?: ApiCallOptions,
): Promise<CResult<SocketSdkSuccessResult<T>['data']>> {
  const { cache, cacheNamespace, cacheTtl, ...sdkOptions } = options || {}

  if (cache) {
    return await withCache(
      method as string,
      args,
      () => withSdk(
        sdk => (sdk[method] as any)(...args),
        description,
        sdkOptions,
      ),
      {
        namespace: cacheNamespace || 'api',
        ttl: cacheTtl,
      }
    )
  }

  return await withSdk(
    sdk => (sdk[method] as any)(...args),
    description,
    sdkOptions,
  )
}

/**
 * Simplified repository API calls
 */
export const repoApi = {
  list: (orgSlug: string, params: any, options?: ApiCallOptions) =>
    apiCall('getOrgRepoList', [orgSlug, params], 'list of repositories', options),

  create: (orgSlug: string, params: any, options?: ApiCallOptions) =>
    apiCall('createOrgRepo', [orgSlug, params], 'to create a repository', options),

  delete: (orgSlug: string, repoName: string, options?: ApiCallOptions) =>
    apiCall('deleteOrgRepo', [orgSlug, repoName], 'to delete a repository', options),

  update: (orgSlug: string, repoName: string, params: any, options?: ApiCallOptions) =>
    apiCall('updateOrgRepo', [orgSlug, repoName, params], 'to update a repository', options),

  view: (orgSlug: string, repoName: string, options?: ApiCallOptions) =>
    apiCall('getOrgRepo', [orgSlug, repoName], 'repository', { ...options, cache: true, cacheTtl: 60000 }),
}

/**
 * Simplified organization API calls
 */
export const orgApi = {
  list: (options?: ApiCallOptions) =>
    apiCall('getOrganizations', [], 'list of organizations', { ...options, cache: true, cacheTtl: 300000 }),

  dependencies: (orgSlug: string, params: any, options?: ApiCallOptions) =>
    apiCall('searchDependencies', [orgSlug, params], 'dependencies', options),

  quota: (orgSlug: string, options?: ApiCallOptions) =>
    apiCall('getOrganizationQuota', [orgSlug], 'organization quota', { ...options, cache: true, cacheTtl: 60000 }),

  securityPolicy: (orgSlug: string, options?: ApiCallOptions) =>
    apiCall('getOrganizationSecurityPolicy', [orgSlug], 'security policy', { ...options, cache: true, cacheTtl: 300000 }),

  licensePolicy: (orgSlug: string, options?: ApiCallOptions) =>
    apiCall('getOrganizationLicensePolicy', [orgSlug], 'license policy', { ...options, cache: true, cacheTtl: 300000 }),
}

/**
 * Simplified package API calls
 */
export const packageApi = {
  score: (ecosystem: string, name: string, version: string, options?: ApiCallOptions) =>
    apiCall('getPackageScore', [ecosystem, name, version], 'package score', { ...options, cache: true, cacheTtl: 3600000 }),

  issues: (ecosystem: string, name: string, version: string, options?: ApiCallOptions) =>
    apiCall('getPackageIssues', [ecosystem, name, version], 'package issues', { ...options, cache: true, cacheTtl: 3600000 }),
}

/**
 * Simplified scan API calls
 */
export const scanApi = {
  create: (orgSlug: string, params: any, options?: ApiCallOptions) =>
    apiCall('createOrgScan', [orgSlug, params], 'to create a scan', options),

  list: (orgSlug: string, params: any, options?: ApiCallOptions) =>
    apiCall('getOrgScanList', [orgSlug, params], 'list of scans', { ...options, cache: true, cacheTtl: 30000 }),

  delete: (orgSlug: string, scanId: string, options?: ApiCallOptions) =>
    apiCall('deleteOrgScan', [orgSlug, scanId], 'to delete a scan', options),

  view: (orgSlug: string, scanId: string, options?: ApiCallOptions) =>
    apiCall('getOrgScan', [orgSlug, scanId], 'scan details', { ...options, cache: true, cacheTtl: 60000 }),
}