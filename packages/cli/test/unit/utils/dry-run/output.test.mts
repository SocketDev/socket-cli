import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger before importing the module.
const mockLog = vi.fn()
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => ({
    log: mockLog,
  }),
}))

// Import after mocking.
const { outputDryRunFetch } = await import(
  '../../../../src/utils/dry-run/output.mts'
)

describe('dry-run output utilities', () => {
  beforeEach(() => {
    mockLog.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('outputDryRunFetch', () => {
    it('should output basic message without query params', () => {
      outputDryRunFetch('test data')

      const output = mockLog.mock.calls.map(call => call[0]).join('\n')
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

      const output = mockLog.mock.calls.map(call => call[0]).join('\n')
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

      const output = mockLog.mock.calls.map(call => call[0]).join('\n')
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

      const output = mockLog.mock.calls.map(call => call[0]).join('\n')
      expect(output).toContain('showFullTokens: false')
      expect(output).toContain('enabled: true')
    })

    it('should handle numeric values including zero', () => {
      outputDryRunFetch('paginated data', {
        page: 5,
        perPage: 30,
        offset: 0,
      })

      const output = mockLog.mock.calls.map(call => call[0]).join('\n')
      expect(output).toContain('page: 5')
      expect(output).toContain('perPage: 30')
      // 0 is a valid value and should be shown.
      expect(output).toContain('offset: 0')
    })

    it('should not show query parameters section for empty params object', () => {
      outputDryRunFetch('empty params', {})

      const output = mockLog.mock.calls.map(call => call[0]).join('\n')
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

      const output = mockLog.mock.calls.map(call => call[0]).join('\n')
      expect(output).toContain('stringVal: hello')
      expect(output).toContain('numVal: 42')
      expect(output).toContain('boolTrue: true')
      expect(output).toContain('boolFalse: false')
    })
  })
})
