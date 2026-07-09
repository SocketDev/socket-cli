/**
 * Unit tests for config unset command metadata.
 *
 * Tests the command metadata (description, hidden flag, CMD_NAME) for the
 * unset command.
 *
 * Test Coverage:
 *
 * - Command metadata (description, hidden flag, CMD_NAME)
 *
 * Related Files:
 *
 * - Src/commands/config/cmd-config-unset.mts - Implementation
 * - Src/commands/config/handle-config-unset.mts - Handler
 * - Src/commands/config/config-command-factory.mts - Factory
 */

import { describe, expect, it } from 'vitest'

import {
  CMD_NAME,
  cmdConfigUnset,
} from '../../../../src/commands/config/cmd-config-unset.mts'

describe('cmd-config-unset', () => {
  describe('command metadata', () => {
    it('should export CMD_NAME as unset', () => {
      expect(CMD_NAME).toBe('unset')
    })

    it('should have correct description', () => {
      expect(cmdConfigUnset.description).toBe(
        'Clear the value of a local CLI config item',
      )
    })

    it('should not be hidden', () => {
      expect(cmdConfigUnset.hidden).toBe(false)
    })
  })
})
