/** @fileoverview Type-safe API response utilities */

/**
 * Generic API response wrapper for unknown data structures
 */
export type ApiResponse<T = unknown> = {
  [key: string]: T
}

/**
 * Organization data from API
 */
export interface OrgData {
  id: string
  name: string
  slug?: string
  plan?: string
  role?: string
  image?: string | null
}

/**
 * Repository data from API
 */
export interface RepoData {
  id?: string
  slug?: string
  name?: string
  visibility?: string
  default_branch?: string
  archived?: boolean
  created_at?: string
  updated_at?: string
  html_url?: string
}

/**
 * Package data from API
 */
export interface PackageData {
  name?: string
  version?: string
  ecosystem?: string
  score?: number
  issues?: Array<{
    severity: string
    description: string
    type?: string
  }>
  breakdown?: {
    supply_chain?: number
    maintenance?: number
    vulnerability?: number
    quality?: number
    license?: number
  }
  recommendation?: string
}

/**
 * Scan data from API
 */
export interface ScanData {
  id?: string
  status?: string
  created_at?: string
  updated_at?: string
  vulnerabilities?: number | {
    critical?: number
    high?: number
    medium?: number
    low?: number
  }
  findings?: Array<{
    severity: string
    package: string
    version: string
    description: string
  }>
}

/**
 * Quota data from API
 */
export interface QuotaData {
  quota?: number
  seats_used?: number
  seats_total?: number
  repos_used?: number
  repos_total?: number
  scans_used?: number
  scans_total?: number
}

/**
 * Policy data from API
 */
export interface PolicyData {
  securityPolicyRules?: Record<string, { action: string }>
  securityPolicyDefault?: string
  allowed_licenses?: string[]
  denied_licenses?: string[]
  rules?: Array<{
    name: string
    enabled: boolean
    severity?: string
  }>
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  results?: T[]
  data?: T[]
  rows?: T[]
  nextPage?: number | null
  total?: number
  end?: boolean
  limit?: number
  offset?: number
}

/**
 * Type guard for paginated responses
 */
export function isPaginatedResponse(data: unknown): data is PaginatedResponse<unknown> {
  if (!data || typeof data !== 'object') {return false}
  const obj = data as Record<string, unknown>
  return 'results' in obj || 'data' in obj || 'rows' in obj
}

/**
 * Type guard for organization data
 */
export function isOrgData(data: unknown): data is OrgData {
  if (!data || typeof data !== 'object') {return false}
  const obj = data as Record<string, unknown>
  return typeof obj['id'] === 'string' && typeof obj['name'] === 'string'
}

/**
 * Safe data accessor that avoids 'any' casts
 */
export function safeAccess<T>(
  data: unknown,
  path: string[],
  defaultValue?: T
): T | undefined {
  let current: unknown = data

  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return defaultValue
    }
    current = (current as Record<string, unknown>)[key]
  }

  return current as T
}

/**
 * Extract array from various API response formats
 */
export function extractArray<T = unknown>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data
  }

  if (!data || typeof data !== 'object') {
    return []
  }

  const obj = data as Record<string, unknown>
  return (obj['results'] as T[] | undefined) || (obj['data'] as T[] | undefined) || (obj['rows'] as T[] | undefined) || []
}