import { beforeEach, describe, expect, it, vi } from 'vitest'

import { outputFixResult } from './output-fix-result.mts'

import type { FixMethodEntry } from './coana-fix.mts'
import type { CResult } from '../../types.mts'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: mockLogger,
}))

// Joins everything written to the human-readable channels into one string so
// assertions can look for substrings regardless of which logger method emitted
// them.
function transcript(): string {
  return [
    ...mockLogger.log.mock.calls,
    ...mockLogger.warn.mock.calls,
    ...mockLogger.info.mock.calls,
    ...mockLogger.success.mock.calls,
  ]
    .map(args => args.join(' '))
    .join('\n')
}

function okResult(fixMethods: FixMethodEntry[]): CResult<unknown> {
  return {
    ok: true,
    data: { fixedAll: true, fixMethods, ghsaDetails: [] },
  }
}

describe('outputFixResult report shape', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('text / markdown output', () => {
    it('clearly marks vulnerabilities resolved via override vs upgrade', async () => {
      await outputFixResult(
        okResult([
          {
            ghsaId: 'GHSA-aaaa-aaaa-aaaa',
            fixedVersion: '4.17.21',
            method: 'override',
            purl: 'pkg:npm/lodash@4.17.21',
          },
          {
            ghsaId: 'GHSA-bbbb-bbbb-bbbb',
            fixedVersion: '1.2.6',
            method: 'upgrade',
            purl: 'pkg:npm/minimist@1.2.6',
          },
        ]),
        'text',
      )

      const out = transcript()
      // The override is explicitly called out, with its GHSA and purl.
      expect(out).toContain('writing overrides')
      expect(out).toContain('GHSA-aaaa-aaaa-aaaa')
      expect(out).toContain('pkg:npm/lodash@4.17.21')
      expect(out).toContain('(override)')
      // The standard upgrade is acknowledged separately.
      expect(out).toContain('standard upgrade')
      expect(mockLogger.success).toHaveBeenCalledWith('Finished!')
    })

    it('keeps the quiet output when every fix was a standard upgrade', async () => {
      await outputFixResult(
        okResult([
          {
            ghsaId: 'GHSA-bbbb-bbbb-bbbb',
            fixedVersion: '1.2.6',
            method: 'upgrade',
            purl: 'pkg:npm/minimist@1.2.6',
          },
        ]),
        'text',
      )

      const out = transcript()
      expect(out).not.toContain('writing overrides')
      expect(out).not.toContain('(override)')
      expect(mockLogger.warn).not.toHaveBeenCalled()
      expect(mockLogger.success).toHaveBeenCalledWith('Finished!')
    })

    it('is a no-op summary when there are no fix methods', async () => {
      await outputFixResult(okResult([]), 'text')

      expect(mockLogger.warn).not.toHaveBeenCalled()
      expect(mockLogger.success).toHaveBeenCalledWith('Finished!')
    })
  })

  describe('json output', () => {
    it('serializes the per-fix method so override vs upgrade is machine-readable', async () => {
      await outputFixResult(
        okResult([
          {
            ghsaId: 'GHSA-aaaa-aaaa-aaaa',
            fixedVersion: '4.17.21',
            method: 'override',
            purl: 'pkg:npm/lodash@4.17.21',
          },
        ]),
        'json',
      )

      expect(mockLogger.log).toHaveBeenCalledTimes(1)
      const json = mockLogger.log.mock.calls[0]?.[0] as string
      const parsed = JSON.parse(json)
      expect(parsed.data.fixMethods).toEqual([
        {
          ghsaId: 'GHSA-aaaa-aaaa-aaaa',
          fixedVersion: '4.17.21',
          method: 'override',
          purl: 'pkg:npm/lodash@4.17.21',
        },
      ])
    })
  })
})
