/** @fileoverview Lazy loading utility for Ink/React components to reduce bundle size */

import { getDefaultLogger } from '@socketsecurity/lib/logger'
const logger = getDefaultLogger()

/**
 * Lazily load Ink and React dependencies only when needed
 * This prevents React from being bundled in the main CLI bundle
 */
export async function loadInk(): Promise<{ ink: any; React: any }> {
  try {
    // Dynamic import to create a separate chunk
    const [ink, React] = await Promise.all([import('ink'), import('react')])
    return { ink, React }
  } catch (error) {
    logger.error('Failed to load Ink/React components')
    throw error
  }
}

/**
 * Lazily load ink-table component
 */
export async function loadInkTable() {
  try {
    const { default: Table } = await import('ink-table')
    return Table
  } catch (error) {
    logger.error('Failed to load ink-table component')
    throw error
  }
}

/**
 * Check if Ink/React is available without loading it
 */
export function isInkAvailable(): boolean {
  try {
    // Check if modules exist without loading them
    require.resolve('ink')
    require.resolve('react')
    return true
  } catch {
    return false
  }
}

/**
 * Create a lazy loader for a specific Ink component
 */
export function createLazyInkComponent<T extends (...args: any[]) => any>(
  loader: () => Promise<T>,
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let cachedComponent: T | null = null

  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    if (!cachedComponent) {
      cachedComponent = await loader()
    }
    return cachedComponent(...args)
  }
}
