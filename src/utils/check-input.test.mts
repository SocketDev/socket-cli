import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { OUTPUT_JSON, OUTPUT_MARKDOWN, OUTPUT_TEXT } from '../constants.mts'
import { checkCommandInput } from './check-input.mts'

// Mock dependencies.
vi.mock('yoctocolors-cjs', () => ({
  default: {
    green: vi.fn(str => `green(${str})`),
    red: vi.fn(str => `red(${str})`),
  },
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  LOG_SYMBOLS: {
    success: '✓',
    fail: '✗',
  },
  logger: {
    fail: vi.fn(),
    log: vi.fn(),
  },
}))

vi.mock('@socketsecurity/registry/lib/strings', () => ({
  stripAnsi: vi.fn(str => str),
}))

vi.mock('./fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: vi.fn((title, msg) => `${title}: ${msg}`),
}))

vi.mock('./serialize-result-json.mts', () => ({
  serializeResultJson: vi.fn(result => JSON.stringify(result)),
}))

describe('checkCommandInput', () => {
  let originalExitCode: number | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    // Save original exit code.
    originalExitCode = process.exitCode
    process.exitCode = undefined
  })

  afterEach(() => {
    // Restore original exit code.
    process.exitCode = originalExitCode
  })

  describe('when all checks pass', () => {
    it('returns true and does not set exit code', () => {
      const result = checkCommandInput(
        OUTPUT_TEXT,
        {
          test: true,
          fail: 'Failed',
          message: 'Check 1',
        },
        {
          test: true,
          fail: 'Failed',
          message: 'Check 2',
        },
      )

      expect(result).toBe(true)
      expect(process.exitCode).toBeUndefined()
    })

    it('returns true for json output kind', () => {
      const result = checkCommandInput(OUTPUT_JSON, {
        test: true,
        fail: 'Failed',
        message: 'Check 1',
      })

      expect(result).toBe(true)
      expect(process.exitCode).toBeUndefined()
    })

    it('returns true for markdown output kind', () => {
      const result = checkCommandInput(OUTPUT_MARKDOWN, {
        test: true,
        fail: 'Failed',
        message: 'Check 1',
      })

      expect(result).toBe(true)
      expect(process.exitCode).toBeUndefined()
    })
  })

  describe('when some checks fail', () => {
    it('returns false and sets exit code to 2', async () => {
      const { logger } = vi.mocked(
        await import('@socketsecurity/registry/lib/logger'),
      )
      const { failMsgWithBadge } = vi.mocked(
        await import('./fail-msg-with-badge.mts'),
      )

      const result = checkCommandInput(
        OUTPUT_TEXT,
        {
          test: false,
          fail: 'Missing file',
          message: 'File must exist',
        },
        {
          test: true,
          fail: 'Failed',
          message: 'Check 2',
          pass: 'Passed',
        },
      )

      expect(result).toBe(false)
      expect(process.exitCode).toBe(2)
      expect(failMsgWithBadge).toHaveBeenCalledWith(
        'Input error',
        expect.stringContaining('✗ File must exist (red(Missing file))'),
      )
      expect(failMsgWithBadge).toHaveBeenCalledWith(
        'Input error',
        expect.stringContaining('✓ Check 2 (green(Passed))'),
      )
      expect(logger.fail).toHaveBeenCalled()
    })

    it('handles json output kind', async () => {
      const { logger } = vi.mocked(
        await import('@socketsecurity/registry/lib/logger'),
      )
      const { serializeResultJson } = vi.mocked(
        await import('./serialize-result-json.mts'),
      )

      const result = checkCommandInput(OUTPUT_JSON, {
        test: false,
        fail: 'Invalid input',
        message: 'Input validation failed',
      })

      expect(result).toBe(false)
      expect(process.exitCode).toBe(2)
      expect(serializeResultJson).toHaveBeenCalledWith({
        ok: false,
        message: 'Input error',
        data: expect.stringContaining('✗ Input validation failed'),
      })
      expect(logger.log).toHaveBeenCalled()
    })
  })

  describe('message formatting', () => {
    it('handles multi-line messages', async () => {
      const { failMsgWithBadge } = vi.mocked(
        await import('./fail-msg-with-badge.mts'),
      )

      checkCommandInput(OUTPUT_TEXT, {
        test: false,
        fail: 'Error',
        message: 'First line\nSecond line\nThird line',
      })

      expect(failMsgWithBadge).toHaveBeenCalledWith(
        'Input error',
        expect.stringContaining(
          '✗ First line (red(Error))\n    Second line\n    Third line',
        ),
      )
    })

    it('handles empty messages', async () => {
      const { failMsgWithBadge } = vi.mocked(
        await import('./fail-msg-with-badge.mts'),
      )

      checkCommandInput(
        OUTPUT_TEXT,
        {
          test: false,
          fail: 'Error',
          message: '',
        },
        {
          test: false,
          fail: 'Another error',
          message: 'Valid message',
        },
      )

      const callArg = failMsgWithBadge.mock.calls[0][1]
      expect(callArg).not.toContain('✗  ')
      expect(callArg).toContain('✗ Valid message')
    })

    it('handles messages without fail/pass reasons', async () => {
      const { failMsgWithBadge } = vi.mocked(
        await import('./fail-msg-with-badge.mts'),
      )

      checkCommandInput(
        OUTPUT_TEXT,
        {
          test: false,
          fail: '',
          message: 'Check failed',
        },
        {
          test: true,
          pass: '',
          fail: '',
          message: 'Check passed',
        },
      )

      const callArg = failMsgWithBadge.mock.calls[0][1]
      expect(callArg).toContain('✗ Check failed')
      expect(callArg).toContain('✓ Check passed')
      expect(callArg).not.toContain('()')
    })
  })

  describe('nook behavior', () => {
    it('skips checks where nook is true and test passes', async () => {
      const { failMsgWithBadge } = vi.mocked(
        await import('./fail-msg-with-badge.mts'),
      )

      checkCommandInput(
        OUTPUT_TEXT,
        {
          test: true,
          fail: 'Should not appear',
          message: 'This check is skipped',
          nook: true,
        },
        {
          test: false,
          fail: 'This appears',
          message: 'This check is included',
        },
      )

      const callArg = failMsgWithBadge.mock.calls[0][1]
      expect(callArg).not.toContain('This check is skipped')
      expect(callArg).toContain('This check is included')
    })

    it('includes checks where nook is true but test fails', async () => {
      const { failMsgWithBadge } = vi.mocked(
        await import('./fail-msg-with-badge.mts'),
      )

      checkCommandInput(OUTPUT_TEXT, {
        test: false,
        fail: 'Should appear',
        message: 'This check failed',
        nook: true,
      })

      const callArg = failMsgWithBadge.mock.calls[0][1]
      expect(callArg).toContain('This check failed')
      expect(callArg).toContain('Should appear')
    })

    it('handles nook as undefined', async () => {
      const { failMsgWithBadge } = vi.mocked(
        await import('./fail-msg-with-badge.mts'),
      )

      checkCommandInput(
        OUTPUT_TEXT,
        {
          test: true,
          fail: 'Failed',
          message: 'Normal check',
          pass: 'Passed',
          nook: undefined,
        },
        {
          test: false,
          fail: 'Failed',
          message: 'Failed check',
        },
      )

      const callArg = failMsgWithBadge.mock.calls[0][1]
      expect(callArg).toContain('✓ Normal check (green(Passed))')
      expect(callArg).toContain('✗ Failed check (red(Failed))')
    })
  })

  describe('edge cases', () => {
    it('handles empty array of checks', () => {
      const result = checkCommandInput(OUTPUT_TEXT)

      expect(result).toBe(true)
      expect(process.exitCode).toBeUndefined()
    })

    it('handles all passing checks with various output kinds', () => {
      const checks = [
        {
          test: true,
          fail: 'Failed',
          message: 'Check 1',
        },
      ]

      expect(checkCommandInput(OUTPUT_TEXT, ...checks)).toBe(true)
      expect(checkCommandInput(OUTPUT_JSON, ...checks)).toBe(true)
      expect(checkCommandInput(OUTPUT_MARKDOWN, ...checks)).toBe(true)
    })

    it('strips ANSI codes for JSON output', async () => {
      const { stripAnsi } = vi.mocked(
        await import('@socketsecurity/registry/lib/strings'),
      )
      const { serializeResultJson } = vi.mocked(
        await import('./serialize-result-json.mts'),
      )

      stripAnsi.mockReturnValue('Stripped message')

      checkCommandInput(OUTPUT_JSON, {
        test: false,
        fail: 'Failed',
        message: 'Message with ANSI',
      })

      expect(stripAnsi).toHaveBeenCalled()
      expect(serializeResultJson).toHaveBeenCalledWith(
        expect.objectContaining({
          data: 'Stripped message',
        }),
      )
    })
  })

  describe('mixed pass and fail checks', () => {
    it('handles mixed results correctly', async () => {
      const { failMsgWithBadge } = vi.mocked(
        await import('./fail-msg-with-badge.mts'),
      )

      checkCommandInput(
        OUTPUT_TEXT,
        { test: true, fail: 'Failed', message: 'Check 1 passes' },
        { test: false, fail: 'Failed', message: 'Check 2 fails' },
        {
          test: true,
          fail: 'Failed',
          message: 'Check 3 passes',
          pass: 'Success',
        },
      )

      const callArg = failMsgWithBadge.mock.calls[0][1]
      expect(callArg).toContain('✓ Check 1 passes')
      expect(callArg).toContain('✗ Check 2 fails')
      expect(callArg).toContain('✓ Check 3 passes (green(Success))')
    })
  })
})
