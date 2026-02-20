/**
 * Unit tests for ask command.
 *
 * Tests the command entry point that parses natural language queries
 * and translates them into Socket CLI commands.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock spawn to prevent actual command execution.
vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: vi.fn().mockResolvedValue({ code: 0 }),
}))

// Import after mocks.
const { cmdAsk } = await import('../../../../src/commands/ask/cmd-ask.mts')

describe('cmd-ask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdAsk.description).toBe('Ask in plain English')
    })

    it('should not be hidden', () => {
      expect(cmdAsk.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-ask.mts' }
    const context = { parentName: 'socket' }

    it('should throw InputError when no query provided', async () => {
      await expect(cmdAsk.run([], importMeta, context)).rejects.toThrow(
        'Please provide a question',
      )
    })

    it('should process query and output result', async () => {
      await cmdAsk.run(['scan for vulnerabilities'], importMeta, context)

      // Should log the query interpretation.
      expect(mockLogger.log).toHaveBeenCalled()
    })

    it('should show tip about --execute flag when not executing', async () => {
      await cmdAsk.run(['fix issues'], importMeta, context)

      // Should show tip about execute flag.
      const logCalls = mockLogger.log.mock.calls.flat()
      const hasTip = logCalls.some(
        call => typeof call === 'string' && call.includes('--execute'),
      )
      expect(hasTip).toBe(true)
    })
  })
})
