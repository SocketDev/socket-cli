/**
 * @fileoverview Unit tests for spinner animation utilities.
 *
 * Tests spinner animation wrappers and lifecycle:
 * - withSpinner() wraps async operations with animated spinner
 * - withSpinnerSync() wraps sync operations with spinner
 * - Spinner class for manual control (start, stop, update text)
 * - Color preservation after spinner operations
 * - CI detection: spinners disabled in CI environments
 * Used by Socket CLI for long-running operations (package scanning, API calls).
 */

import {
  Spinner,
  withSpinner,
  withSpinnerSync,
} from '@socketsecurity/lib/spinner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('spinner', () => {
  // Mock stdout/stderr to prevent actual spinner output during tests
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  describe('withSpinner', () => {
    it('should restore color after operation', async () => {
      const spinner = Spinner({ color: [140, 82, 255] })
      const originalColor = spinner.color

      await withSpinner({
        message: 'Testing...',
        operation: async () => {
          // During operation, color should be red
          expect(spinner.color).toEqual([255, 0, 0])
        },
        spinner,
        withOptions: {
          color: [255, 0, 0], // Red
        },
      })

      // After operation, color should be restored
      expect(spinner.color).toEqual(originalColor)
    })

    it('should restore color after operation with named color', async () => {
      const spinner = Spinner({ color: 'cyan' })
      const originalColor = spinner.color

      await withSpinner({
        message: 'Testing...',
        operation: async () => {
          // Just verify operation runs
          expect(true).toBe(true)
        },
        spinner,
        withOptions: {
          color: 'red',
        },
      })

      // After operation, color should be restored
      expect(spinner.color).toEqual(originalColor)
    })

    it('should restore shimmer state after operation', async () => {
      const spinner = Spinner({ shimmer: { dir: 'ltr', speed: 0.5 } })
      const originalShimmer = spinner.shimmerState

      await withSpinner({
        message: 'Testing...',
        operation: async () => {
          // During operation, shimmer should be different
          expect(spinner.shimmerState?.mode).toBe('rtl')
        },
        spinner,
        withOptions: {
          shimmer: { dir: 'rtl' },
        },
      })

      // After operation, shimmer should be restored
      expect(spinner.shimmerState?.mode).toBe(originalShimmer?.mode)
      expect(spinner.shimmerState?.speed).toBe(originalShimmer?.speed)
    })

    it('should disable shimmer after operation if it was disabled before', async () => {
      const spinner = Spinner() // No shimmer

      await withSpinner({
        message: 'Testing...',
        operation: async () => {
          // During operation, shimmer should be enabled
          expect(spinner.shimmerState).toBeDefined()
        },
        spinner,
        withOptions: {
          shimmer: { dir: 'ltr' },
        },
      })

      // After operation, shimmer should be disabled again
      expect(spinner.shimmerState).toBeUndefined()
    })

    it('should work without withOptions', async () => {
      const spinner = Spinner({ color: [140, 82, 255] })
      const originalColor = spinner.color

      await withSpinner({
        message: 'Testing...',
        operation: async () => {
          expect(true).toBe(true)
        },
        spinner,
      })

      // Color should remain unchanged
      expect(spinner.color).toEqual(originalColor)
    })

    it('should work without spinner instance', async () => {
      const result = await withSpinner({
        message: 'Testing...',
        operation: async () => 42,
      })

      expect(result).toBe(42)
    })

    it('should restore state even if operation throws', async () => {
      const spinner = Spinner({ color: [140, 82, 255] })
      const originalColor = spinner.color

      await expect(
        withSpinner({
          message: 'Testing...',
          operation: async () => {
            throw new Error('Test error')
          },
          spinner,
          withOptions: {
            color: [255, 0, 0],
          },
        }),
      ).rejects.toThrow('Test error')

      // Color should still be restored
      expect(spinner.color).toEqual(originalColor)
    })
  })

  describe('withSpinnerSync', () => {
    it('should restore color after operation', () => {
      const spinner = Spinner({ color: [140, 82, 255] })
      const originalColor = spinner.color

      withSpinnerSync({
        message: 'Testing...',
        operation: () => {
          // During operation, color should be red
          expect(spinner.color).toEqual([255, 0, 0])
        },
        spinner,
        withOptions: {
          color: [255, 0, 0], // Red
        },
      })

      // After operation, color should be restored
      expect(spinner.color).toEqual(originalColor)
    })

    it('should restore shimmer state after operation', () => {
      const spinner = Spinner({ shimmer: { dir: 'ltr', speed: 0.5 } })
      const originalShimmer = spinner.shimmerState

      withSpinnerSync({
        message: 'Testing...',
        operation: () => {
          // During operation, shimmer should be different
          expect(spinner.shimmerState?.mode).toBe('rtl')
        },
        spinner,
        withOptions: {
          shimmer: { dir: 'rtl' },
        },
      })

      // After operation, shimmer should be restored
      expect(spinner.shimmerState?.mode).toBe(originalShimmer?.mode)
      expect(spinner.shimmerState?.speed).toBe(originalShimmer?.speed)
    })

    it('should work without withOptions', () => {
      const spinner = Spinner({ color: [140, 82, 255] })
      const originalColor = spinner.color

      withSpinnerSync({
        message: 'Testing...',
        operation: () => {
          expect(true).toBe(true)
        },
        spinner,
      })

      // Color should remain unchanged
      expect(spinner.color).toEqual(originalColor)
    })

    it('should restore state even if operation throws', () => {
      const spinner = Spinner({ color: [140, 82, 255] })
      const originalColor = spinner.color

      expect(() => {
        withSpinnerSync({
          message: 'Testing...',
          operation: () => {
            throw new Error('Test error')
          },
          spinner,
          withOptions: {
            color: [255, 0, 0],
          },
        })
      }).toThrow('Test error')

      // Color should still be restored
      expect(spinner.color).toEqual(originalColor)
    })
  })
})
