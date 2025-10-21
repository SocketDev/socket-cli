/** @fileoverview Handle test helpers for Socket CLI. Provides utilities for testing handle functions that orchestrate fetch + output. */

import { vi } from 'vitest'

/**
 * Derive function name from module path
 * @param path - Module path (e.g., './fetch-view-repo.mts')
 * @param prefix - Function prefix ('fetch' or 'output')
 * @returns Function name (e.g., 'fetchViewRepo')
 */
function deriveFunctionName(path: string, prefix: string): string {
  const filename = path.split('/').pop()?.replace('.mts', '') || ''
  const parts = filename.split('-')

  if (parts[0] === prefix) {
    // Remove prefix and convert to camelCase
    return parts
      .map((part, i) =>
        i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
      )
      .join('')
  }

  // Assume it's already in the right format
  return filename.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Setup mocks for a standard handle function pattern
 * This is the recommended helper for handle tests
 *
 * Call this at the module level (before describe block) to setup vi.mock calls.
 * Then in each test, use dynamic imports to get the mocked functions.
 *
 * @param fetchModulePath - Path to fetch module (e.g., './fetch-quota.mts')
 * @param outputModulePath - Path to output module (e.g., './output-quota.mts')
 * @param fetchFunctionName - Optional fetch function name (auto-derived if not provided)
 * @param outputFunctionName - Optional output function name (auto-derived if not provided)
 *
 * @example
 * ```typescript
 * import { setupStandardHandleMocks } from '../../../test/helpers/index.mts'
 *
 * // Setup mocks at module level (before describe)
 * setupStandardHandleMocks('./fetch-quota.mts', './output-quota.mts')
 *
 * describe('handleQuota', () => {
 *   it('fetches and outputs quota', async () => {
 *     const { fetchQuota } = await import('./fetch-quota.mts')
 *     const { outputQuota } = await import('./output-quota.mts')
 *     const mockFetch = vi.mocked(fetchQuota)
 *     const mockOutput = vi.mocked(outputQuota)
 *
 *     mockFetch.mockResolvedValue({ quota: 100 })
 *     mockOutput.mockResolvedValue()
 *
 *     await handleQuota('json')
 *
 *     expect(mockFetch).toHaveBeenCalled()
 *     expect(mockOutput).toHaveBeenCalledWith({ quota: 100 }, 'json')
 *   })
 * })
 * ```
 */
export function setupStandardHandleMocks(
  fetchModulePath: string,
  outputModulePath: string,
  fetchFunctionName?: string,
  outputFunctionName?: string,
) {
  const fetchName =
    fetchFunctionName || deriveFunctionName(fetchModulePath, 'fetch')
  const outputName =
    outputFunctionName || deriveFunctionName(outputModulePath, 'output')

  vi.mock(fetchModulePath, () => ({
    [fetchName]: vi.fn(),
  }))

  vi.mock(outputModulePath, () => ({
    [outputName]: vi.fn(),
  }))
}
