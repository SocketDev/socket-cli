/**
 * @fileoverview Handle test helpers for Socket CLI.
 *
 * Note: Due to Vitest's hoisting mechanism, vi.mock() calls must be at the module
 * top level and cannot be abstracted into helper functions. For handle function tests,
 * use the standard pattern directly:
 *
 * @example
 * ```typescript
 * import { describe, expect, it, vi } from 'vitest'
 *
 * // Setup mocks at module level (before describe)
 * vi.mock('./fetch-quota.mts', () => ({
 *   fetchQuota: vi.fn(),
 * }))
 * vi.mock('./output-quota.mts', () => ({
 *   outputQuota: vi.fn(),
 * }))
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
