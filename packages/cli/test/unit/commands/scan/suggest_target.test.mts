/**
 * Unit tests for target suggestion utility.
 *
 * Purpose:
 * Tests the target directory suggestion prompt.
 *
 * Test Coverage:
 * - suggestTarget function
 * - User accepts current directory
 * - User rejects current directory
 *
 * Related Files:
 * - src/commands/scan/suggest_target.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock select prompt.
const mockSelect = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  select: mockSelect,
}))

import { suggestTarget } from '../../../../src/commands/scan/suggest_target.mts'

describe('suggest_target', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('suggestTarget', () => {
    it('returns ["."] when user accepts current directory', async () => {
      mockSelect.mockResolvedValue(true)

      const result = await suggestTarget()

      expect(result).toEqual(['.'])
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('current directory'),
        }),
      )
    })

    it('returns [] when user rejects current directory', async () => {
      mockSelect.mockResolvedValue(false)

      const result = await suggestTarget()

      expect(result).toEqual([])
    })

    it('prompts with Yes and No choices', async () => {
      mockSelect.mockResolvedValue(true)

      await suggestTarget()

      const callArg = mockSelect.mock.calls[0]![0] as {
        choices: Array<{ name: string; value: boolean }>
      }
      expect(callArg.choices).toHaveLength(2)
      expect(callArg.choices[0]!.name).toBe('Yes')
      expect(callArg.choices[0]!.value).toBe(true)
      expect(callArg.choices[1]!.name).toBe('No')
      expect(callArg.choices[1]!.value).toBe(false)
    })
  })
})
