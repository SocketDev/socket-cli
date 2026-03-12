/**
 * Unit tests for branch slug suggestion utility.
 *
 * Purpose:
 * Tests the branch slug suggestion prompt for scan commands.
 *
 * Test Coverage:
 * - suggestBranchSlug function
 * - Git branch detection
 * - User selection handling
 * - Default branch fallback
 *
 * Related Files:
 * - src/commands/scan/suggest_branch_slug.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock spawn.
const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
}))

// Mock select prompt.
const mockSelect = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  select: mockSelect,
}))

// Mock stripAnsi.
vi.mock('@socketsecurity/lib/strings', () => ({
  stripAnsi: (str: string) => str,
}))

import { suggestBranchSlug } from '../../../../src/commands/scan/suggest_branch_slug.mts'

describe('suggest_branch_slug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('suggestBranchSlug', () => {
    it('returns undefined when spawn returns null', async () => {
      mockSpawn.mockResolvedValue(null)

      const result = await suggestBranchSlug('main')

      expect(result).toBeUndefined()
      expect(mockSelect).not.toHaveBeenCalled()
    })

    it('returns undefined when git branch fails', async () => {
      mockSpawn.mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'Not a git repository',
      })

      const result = await suggestBranchSlug('main')

      expect(result).toBeUndefined()
    })

    it('returns selected branch when user confirms current branch', async () => {
      mockSpawn.mockResolvedValue({
        code: 0,
        stdout: 'feature-branch',
        stderr: '',
      })
      mockSelect.mockResolvedValue('feature-branch')

      const result = await suggestBranchSlug('main')

      expect(result).toBe('feature-branch')
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Use the current git branch as target branch name?',
        }),
      )
    })

    it('includes default branch option when different from current', async () => {
      mockSpawn.mockResolvedValue({
        code: 0,
        stdout: 'feature-branch',
        stderr: '',
      })
      mockSelect.mockResolvedValue('main')

      const result = await suggestBranchSlug('main')

      expect(result).toBe('main')
      const selectArg = mockSelect.mock.calls[0]![0] as {
        choices: Array<{ name: string; value: string }>
      }
      const defaultBranchChoice = selectArg.choices.find(c =>
        c.name.includes('default branch'),
      )
      expect(defaultBranchChoice).toBeDefined()
      expect(defaultBranchChoice!.value).toBe('main')
    })

    it('does not include default branch option when same as current', async () => {
      mockSpawn.mockResolvedValue({
        code: 0,
        stdout: 'main',
        stderr: '',
      })
      mockSelect.mockResolvedValue('main')

      await suggestBranchSlug('main')

      const selectArg = mockSelect.mock.calls[0]![0] as {
        choices: Array<{ name: string; value: string }>
      }
      const defaultBranchChoice = selectArg.choices.find(c =>
        c.name.includes('default branch'),
      )
      expect(defaultBranchChoice).toBeUndefined()
    })

    it('returns undefined when user selects No', async () => {
      mockSpawn.mockResolvedValue({
        code: 0,
        stdout: 'feature-branch',
        stderr: '',
      })
      mockSelect.mockResolvedValue('')

      const result = await suggestBranchSlug('main')

      expect(result).toBeUndefined()
    })

    it('handles stdout as Buffer', async () => {
      mockSpawn.mockResolvedValue({
        code: 0,
        stdout: Buffer.from('feature-branch'),
        stderr: '',
      })
      mockSelect.mockResolvedValue('feature-branch')

      const result = await suggestBranchSlug('main')

      expect(result).toBe('feature-branch')
    })

    it('trims whitespace from branch name', async () => {
      mockSpawn.mockResolvedValue({
        code: 0,
        stdout: '  feature-branch  \n',
        stderr: '',
      })
      mockSelect.mockResolvedValue('feature-branch')

      const result = await suggestBranchSlug('main')

      expect(result).toBe('feature-branch')
    })

    it('works without default branch parameter', async () => {
      mockSpawn.mockResolvedValue({
        code: 0,
        stdout: 'feature-branch',
        stderr: '',
      })
      mockSelect.mockResolvedValue('feature-branch')

      const result = await suggestBranchSlug(undefined)

      expect(result).toBe('feature-branch')
      const selectArg = mockSelect.mock.calls[0]![0] as {
        choices: Array<{ name: string; value: string }>
      }
      // Should not include default branch option when undefined.
      const defaultBranchChoice = selectArg.choices.find(c =>
        c.name.includes('default branch'),
      )
      expect(defaultBranchChoice).toBeUndefined()
    })

    it('returns undefined when branch is empty after trim', async () => {
      mockSpawn.mockResolvedValue({
        code: 0,
        stdout: '   ',
        stderr: '',
      })

      const result = await suggestBranchSlug('main')

      expect(result).toBeUndefined()
      expect(mockSelect).not.toHaveBeenCalled()
    })
  })
})
