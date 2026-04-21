import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Dry-run previews are contextual output and always route to stderr
// per the stream discipline rule (CLAUDE.md SHARED STANDARDS). The
// mocks capture both streams separately so we can assert routing.
const mockStdoutLog = vi.fn()
const mockStderrLog = vi.fn()
const mockLog = vi.fn((...args: unknown[]) => {
  mockStderrLog(...args)
})

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => ({
    log: (...args: unknown[]) => {
      mockStdoutLog(...args)
    },
    error: (...args: unknown[]) => {
      mockLog(...args)
    },
  }),
}))

const { outputDryRunFetch } = await import(
  '../../../../src/utils/dry-run/output.mts'
)

describe('dry-run output utilities', () => {
  beforeEach(() => {
    mockLog.mockClear()
    mockStdoutLog.mockClear()
    mockStderrLog.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('outputDryRunFetch', () => {
    it('should output basic message without query params', () => {
      outputDryRunFetch('test data')

      const output = mockStderrLog.mock.calls
        .map(call => call[0])
        .join('\n')
      expect(output).toContain('[DryRun]: Would fetch test data')
      expect(output).toContain('This is a read-only operation')
      expect(output).toContain('Run without --dry-run')
      expect(output).not.toContain('Query parameters')
    })

    it('should output query parameters when provided', () => {
      outputDryRunFetch('threat feed data', {
        organization: 'my-org',
        ecosystem: 'npm',
        page: 1,
      })

      const output = mockStderrLog.mock.calls
        .map(call => call[0])
        .join('\n')
      expect(output).toContain('[DryRun]: Would fetch threat feed data')
      expect(output).toContain('Query parameters:')
      expect(output).toContain('organization: my-org')
      expect(output).toContain('ecosystem: npm')
      expect(output).toContain('page: 1')
    })

    it('should skip undefined and empty string values', () => {
      outputDryRunFetch('analytics data', {
        scope: 'org',
        repo: undefined,
        filter: '',
        time: '30 days',
      })

      const output = mockStderrLog.mock.calls
        .map(call => call[0])
        .join('\n')
      expect(output).toContain('scope: org')
      expect(output).toContain('time: 30 days')
      expect(output).not.toContain('repo:')
      expect(output).not.toContain('filter:')
    })

    it('should handle boolean values', () => {
      outputDryRunFetch('config settings', {
        showFullTokens: false,
        enabled: true,
      })

      const output = mockStderrLog.mock.calls
        .map(call => call[0])
        .join('\n')
      expect(output).toContain('showFullTokens: false')
      expect(output).toContain('enabled: true')
    })

    it('should handle numeric values including zero', () => {
      outputDryRunFetch('paginated data', {
        page: 5,
        perPage: 30,
        offset: 0,
      })

      const output = mockStderrLog.mock.calls
        .map(call => call[0])
        .join('\n')
      expect(output).toContain('page: 5')
      expect(output).toContain('perPage: 30')
      expect(output).toContain('offset: 0')
    })

    it('should not show query parameters section for empty params object', () => {
      outputDryRunFetch('empty params', {})

      const output = mockStderrLog.mock.calls
        .map(call => call[0])
        .join('\n')
      expect(output).toContain('[DryRun]: Would fetch empty params')
      expect(output).not.toContain('Query parameters')
    })

    it('should format different value types correctly', () => {
      outputDryRunFetch('mixed types', {
        stringVal: 'hello',
        numVal: 42,
        boolTrue: true,
        boolFalse: false,
      })

      const output = mockStderrLog.mock.calls
        .map(call => call[0])
        .join('\n')
      expect(output).toContain('stringVal: hello')
      expect(output).toContain('numVal: 42')
      expect(output).toContain('boolTrue: true')
      expect(output).toContain('boolFalse: false')
    })
  })

  describe('stream routing', () => {
    it('routes all dry-run preview text to stderr by default', () => {
      outputDryRunFetch('anything', { k: 'v' })

      expect(mockStdoutLog).not.toHaveBeenCalled()
      expect(mockStderrLog).toHaveBeenCalled()
    })

    it('still routes to stderr even without explicit machine mode', () => {
      // Dry-run previews are context, not payload — stderr always.
      // This replaces the prior "stays on stdout by default" test.
      outputDryRunFetch('anything', { k: 'v' })

      expect(mockStdoutLog).not.toHaveBeenCalled()
      expect(mockStderrLog).toHaveBeenCalled()
    })
  })
})
