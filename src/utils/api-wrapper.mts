/** @fileoverview Simplified API wrapper to DRY out repetitive fetch-*.mts files */

import { withCache } from './offline-cache.mts'
import { withSdk } from './sdk.mts'

import type { BaseFetchOptions, CResult } from '../types.mts'
import type { SocketSdk } from '@socketsecurity/sdk'

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
  // Allow any arguments since we're casting them anyway
  args: any[],
  description: string,
  options?: ApiCallOptions,
): Promise<CResult<any>> {
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
        // Default 5 minutes
        ttl: cacheTtl || 300000,
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
    apiCall('searchDependencies', [orgSlug, params as any], 'dependencies', options),

  quota: (options?: ApiCallOptions) =>
    apiCall('getQuota', [], 'organization quota', { ...options, cache: true, cacheTtl: 60000 }),

  securityPolicy: (orgSlug: string, options?: ApiCallOptions) =>
    apiCall('getOrgSecurityPolicy', [orgSlug], 'security policy', { ...options, cache: true, cacheTtl: 300000 }),

  licensePolicy: (orgSlug: string, options?: ApiCallOptions) =>
    apiCall('getOrgLicensePolicy', [orgSlug], 'license policy', { ...options, cache: true, cacheTtl: 300000 }),
}

/**
 * Simplified package API calls (NPM only)
 */
export const packageApi = {
  score: (name: string, version: string, options?: ApiCallOptions) =>
    apiCall('getScoreByNpmPackage', [name, version], 'package score', { ...options, cache: true, cacheTtl: 3600000 }),

  issues: (name: string, version: string, options?: ApiCallOptions) =>
    apiCall('getIssuesByNpmPackage', [name, version], 'package issues', { ...options, cache: true, cacheTtl: 3600000 }),
}

/**
 * Simplified scan API calls
 */
export const scanApi = {
  // Note: createOrgFullScan requires filepaths, not a simple params object
  // This wrapper may need to be revisited for full scan creation

  list: (orgSlug: string, params: any, options?: ApiCallOptions) =>
    apiCall('getOrgFullScanList', [orgSlug, params], 'list of scans', { ...options, cache: true, cacheTtl: 30000 }),

  delete: (orgSlug: string, scanId: string, options?: ApiCallOptions) =>
    apiCall('deleteOrgFullScan', [orgSlug, scanId], 'to delete a scan', options),

  view: (orgSlug: string, scanId: string, options?: ApiCallOptions) =>
    apiCall('getOrgFullScanBuffered', [orgSlug, scanId], 'scan details', { ...options, cache: true, cacheTtl: 60000 }),

  metadata: (orgSlug: string, scanId: string, options?: ApiCallOptions) =>
    apiCall('getOrgFullScanMetadata', [orgSlug, scanId], 'scan metadata', { ...options, cache: true, cacheTtl: 60000 }),
}