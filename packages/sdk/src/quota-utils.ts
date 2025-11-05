/** @fileoverview Quota utility functions for Socket SDK method cost lookup. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { memoize, once } from '@socketsecurity/lib/memoization'

import type { SocketSdkOperations } from './types'

interface ApiRequirement {
  quota: number
  permissions: string[]
}

interface Requirements {
  api: Record<string, ApiRequirement>
}

/**
 * Load api-method-quota-and-permissions.json data with caching.
 * Internal function for lazy loading quota requirements.
 * Uses once() memoization to ensure file is only read once.
 */
const loadRequirements = once((): Requirements => {
  try {
    // Resolve path relative to this module file location.
    // When compiled, __dirname will point to dist/ directory.
    // In source, __dirname points to src/ directory.
    // api-method-quota-and-permissions.json is in the data directory at the project root.
    const requirementsPath = join(
      __dirname,
      '..',
      'data',
      'api-method-quota-and-permissions.json',
    )

    // Check if the requirements file exists before attempting to read.
    /* c8 ignore next 3 - Error path tested in isolation but memoization prevents coverage in main test run */
    if (!existsSync(requirementsPath)) {
      throw new Error(`Requirements file not found at: ${requirementsPath}`)
    }

    const data = readFileSync(requirementsPath, 'utf8')
    return JSON.parse(data) as Requirements
  } catch (e) {
    /* c8 ignore next 2 - Error wrapping tested in isolation but memoization prevents coverage in main test run */
    throw new Error('Failed to load SDK method requirements', { cause: e })
  }
})

/**
 * Calculate total quota cost for multiple SDK method calls.
 * Returns sum of quota units for all specified methods.
 */
export function calculateTotalQuotaCost(
  methodNames: Array<SocketSdkOperations | string>,
): number {
  return methodNames.reduce<number>((total, methodName) => {
    return total + getQuotaCost(methodName)
  }, 0)
}

/**
 * Get all available SDK methods with their requirements.
 * Returns complete mapping of methods to quota and permissions.
 * Creates a fresh deep copy each time to prevent external mutations.
 */
export function getAllMethodRequirements(): Record<string, ApiRequirement> {
  const reqs = loadRequirements()
  const result: Record<string, ApiRequirement> = {}

  Object.entries(reqs.api).forEach(([methodName, requirement]) => {
    result[methodName] = {
      permissions: [...requirement.permissions],
      quota: requirement.quota,
    }
  })

  return result
}

/**
 * Get complete requirement information for a SDK method.
 * Returns both quota cost and required permissions.
 * Memoized to avoid repeated lookups for the same method.
 */
export const getMethodRequirements = memoize(
  (methodName: SocketSdkOperations | string): ApiRequirement => {
    const reqs = loadRequirements()
    const requirement = reqs.api[methodName as string]

    if (!requirement) {
      throw new Error(`Unknown SDK method: "${String(methodName)}"`)
    }

    return {
      permissions: [...requirement.permissions],
      quota: requirement.quota,
    }
  },
  { name: 'getMethodRequirements' },
)

/**
 * Get all methods that require specific permissions.
 * Returns methods that need any of the specified permissions.
 * Memoized since the same permission queries are often repeated.
 */
export const getMethodsByPermissions = memoize(
  (permissions: string[]): string[] => {
    const reqs = loadRequirements()

    return Object.entries(reqs.api)
      .filter(([, requirement]) => {
        return permissions.some(permission =>
          requirement.permissions.includes(permission),
        )
      })
      .map(([methodName]) => methodName)
      .sort()
  },
  { name: 'getMethodsByPermissions' },
)

/**
 * Get all methods that consume a specific quota amount.
 * Useful for finding high-cost or free operations.
 * Memoized to cache results for commonly queried quota costs.
 */
export const getMethodsByQuotaCost = memoize(
  (quotaCost: number): string[] => {
    const reqs = loadRequirements()

    return Object.entries(reqs.api)
      .filter(([, requirement]) => requirement.quota === quotaCost)
      .map(([methodName]) => methodName)
      .sort()
  },
  { name: 'getMethodsByQuotaCost' },
)

/**
 * Get quota cost for a specific SDK method.
 * Returns the number of quota units consumed by the method.
 * Memoized since quota costs are frequently queried.
 */
export const getQuotaCost = memoize(
  (methodName: SocketSdkOperations | string): number => {
    const reqs = loadRequirements()
    const requirement = reqs.api[methodName as string]

    if (!requirement) {
      throw new Error(`Unknown SDK method: "${String(methodName)}"`)
    }

    return requirement.quota
  },
  { name: 'getQuotaCost' },
)

/**
 * Get quota usage summary grouped by cost levels.
 * Returns methods categorized by their quota consumption.
 * Memoized since the summary structure is immutable after load.
 */
export const getQuotaUsageSummary = memoize(
  (): Record<string, string[]> => {
    const reqs = loadRequirements()
    const summary: Record<string, string[]> = {}

    Object.entries(reqs.api).forEach(([methodName, requirement]) => {
      const costKey = `${requirement.quota} units`

      if (!summary[costKey]) {
        summary[costKey] = []
      }

      summary[costKey].push(methodName)
    })

    // Sort methods within each cost level
    Object.keys(summary).forEach(costKey => {
      summary[costKey]?.sort()
    })

    return summary
  },
  { name: 'getQuotaUsageSummary' },
)

/**
 * Get required permissions for a specific SDK method.
 * Returns array of permission strings needed to call the method.
 * Memoized to cache permission lookups per method.
 */
export const getRequiredPermissions = memoize(
  (methodName: SocketSdkOperations | string): string[] => {
    const reqs = loadRequirements()
    const requirement = reqs.api[methodName as string]

    if (!requirement) {
      throw new Error(`Unknown SDK method: "${String(methodName)}"`)
    }

    return [...requirement.permissions]
  },
  { name: 'getRequiredPermissions' },
)

/**
 * Check if user has sufficient quota for method calls.
 * Returns true if available quota covers the total cost.
 */
export function hasQuotaForMethods(
  availableQuota: number,
  methodNames: Array<SocketSdkOperations | string>,
): boolean {
  const totalCost = calculateTotalQuotaCost(methodNames)
  return availableQuota >= totalCost
}
