/**
 * Unit tests for CLI completion utilities.
 *
 * Purpose:
 * Tests the bash completion script generation and configuration.
 *
 * Test Coverage:
 * - COMPLETION_CMD_PREFIX constant
 * - getCompletionSourcingCommand function
 * - getBashrcDetails function
 *
 * Related Files:
 * - utils/cli/completion.mts (implementation)
 */

import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockExistsSync: ReturnType<typeof vi.spyOn>

// Mock getSocketAppDataPath.
const mockGetSocketAppDataPath = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/constants/paths.mts', async importOriginal => {
  const actual =
    (await importOriginal()) as typeof import('../../../../src/constants/paths.mts')
  return {
    ...actual,
    getSocketAppDataPath: mockGetSocketAppDataPath,
  }
})

import {
  COMPLETION_CMD_PREFIX,
  getBashrcDetails,
  getCompletionSourcingCommand,
} from '../../../../src/utils/cli/completion.mts'

describe('cli/completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync = vi.spyOn(fs, 'existsSync')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('COMPLETION_CMD_PREFIX', () => {
    it('has the correct prefix', () => {
      expect(COMPLETION_CMD_PREFIX).toBe('complete -F _socket_completion')
    })
  })

  describe('getCompletionSourcingCommand', () => {
    it('returns error when completion script does not exist', () => {
      mockExistsSync.mockReturnValue(false)

      const result = getCompletionSourcingCommand()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Tab Completion script not found')
        expect(result.cause).toContain('Expected to find completion script')
      }
    })

    it('returns sourcing command when completion script exists', () => {
      mockExistsSync.mockReturnValue(true)

      const result = getCompletionSourcingCommand()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toContain('source')
        expect(result.data).toContain('socket-completion.bash')
      }
    })

    it('uses forward slashes in sourcing command', () => {
      mockExistsSync.mockReturnValue(true)

      const result = getCompletionSourcingCommand()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).not.toContain('\\')
      }
    })
  })

  describe('getBashrcDetails', () => {
    it('returns error when completion script does not exist', () => {
      mockExistsSync.mockReturnValue(false)

      const result = getBashrcDetails('socket')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Tab Completion script not found')
      }
    })

    it('returns error when config directory cannot be determined', () => {
      mockExistsSync.mockReturnValue(true)
      mockGetSocketAppDataPath.mockReturnValue(null)

      const result = getBashrcDetails('socket')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Could not determine config directory')
      }
    })

    it('returns bashrc details when everything is available', () => {
      mockExistsSync.mockReturnValue(true)
      mockGetSocketAppDataPath.mockReturnValue('/home/user/.socket/config.json')

      const result = getBashrcDetails('socket')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.targetName).toBe('socket')
        expect(result.data.completionCommand).toBe(
          `${COMPLETION_CMD_PREFIX} socket`,
        )
        expect(result.data.toAddToBashrc).toContain('Socket CLI completion')
        expect(result.data.toAddToBashrc).toContain('socket')
        expect(result.data.sourcingCommand).toContain('source')
      }
    })

    it('uses forward slashes in target path', () => {
      mockExistsSync.mockReturnValue(true)
      mockGetSocketAppDataPath.mockReturnValue('/home/user/.socket/config.json')

      const result = getBashrcDetails('socket')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.targetPath).not.toContain('\\')
      }
    })

    it('handles custom command names', () => {
      mockExistsSync.mockReturnValue(true)
      mockGetSocketAppDataPath.mockReturnValue('/home/user/.socket/config.json')

      const result = getBashrcDetails('socket-npm')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.targetName).toBe('socket-npm')
        expect(result.data.completionCommand).toBe(
          `${COMPLETION_CMD_PREFIX} socket-npm`,
        )
        expect(result.data.toAddToBashrc).toContain('socket-npm')
      }
    })
  })
})
