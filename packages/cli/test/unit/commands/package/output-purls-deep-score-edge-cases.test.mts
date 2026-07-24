/**
 * Unit tests for output-purls-deep-score edge cases.
 *
 * Purpose: Tests the no-dependencies markdown-report path and the
 * outputPurlsDeepScore exit-code / output-kind branches.
 *
 * Related Files:
 *
 * - Src/commands/package/output-purls-deep-score.mts (implementation)
 * - Src/commands/package/fixtures/*.json (test fixtures)
 */

import { describe, expect, it } from 'vitest'

import nugetDeep from '../../../../src/commands/package/fixtures/nuget_deep.json' with { type: 'json' }
import {
  createMarkdownReport,
  outputPurlsDeepScore,
} from '../../../../src/commands/package/output-purls-deep-score.mts'

describe('package score output', async () => {
  describe('no-dependencies edge case', () => {
    it('renders the dependency-free path when transitively.dependencyCount is 0', () => {
      const data = {
        purl: 'pkg:npm/single@1.0.0',
        self: {
          purl: 'pkg:npm/single@1.0.0',
          alerts: [],
          capabilities: [],
          score: {
            overall: 100,
            maintenance: 100,
            quality: 100,
            supplyChain: 100,
            vulnerability: 100,
            license: 100,
          },
        },
        transitively: {
          alerts: [],
          capabilities: [],
          dependencyCount: 0,
          func: 'identity',
          lowest: {
            overall: 100,
            maintenance: 100,
            quality: 100,
            supplyChain: 100,
            vulnerability: 100,
            license: 100,
          },
          score: {
            overall: 100,
            maintenance: 100,
            quality: 100,
            supplyChain: 100,
            vulnerability: 100,
            license: 100,
          },
        },
      } as unknown

      const txt = createMarkdownReport(data)
      expect(txt).toContain('It has *no dependencies*')
      expect(txt).toContain(
        'Since it has no dependencies, the shallow score is also the deep score',
      )
      expect(txt).toContain('## Report')
      // Transitive section is omitted for the no-deps path.
      expect(txt).not.toContain('## Transitive Package Results')
    })

    it('renders self-alerts variant when no dependencies exist (line 134)', () => {
      // dependencyCount=0 + non-empty selfAlerts → exercises line 134
      // ('These are the alerts found for this package:').
      const data = {
        purl: 'pkg:npm/lonely@1.0.0',
        self: {
          purl: 'pkg:npm/lonely@1.0.0',
          alerts: [{ severity: 'high', name: 'cve' }],
          capabilities: [],
          score: {
            overall: 80,
            maintenance: 80,
            quality: 80,
            supplyChain: 80,
            vulnerability: 80,
            license: 80,
          },
        },
        transitively: {
          alerts: [],
          capabilities: [],
          dependencyCount: 0,
          func: 'identity',
          lowest: {
            overall: 80,
            maintenance: 80,
            quality: 80,
            supplyChain: 80,
            vulnerability: 80,
            license: 80,
          },
          score: {
            overall: 80,
            maintenance: 80,
            quality: 80,
            supplyChain: 80,
            vulnerability: 80,
            license: 80,
          },
        },
      } as unknown

      const txt = createMarkdownReport(data)
      expect(txt).toContain('These are the alerts found for this package:')
    })

    it('renders empty-deep-results section (lines 189-210)', () => {
      // dependencyCount > 0 but transitively.alerts and capabilities empty
      // → exercises lines 189-191 (no capabilities) and 208-210 (no alerts).
      const data = {
        purl: 'pkg:npm/silent@2.0.0',
        self: {
          purl: 'pkg:npm/silent@2.0.0',
          alerts: [],
          capabilities: [],
          score: {
            overall: 100,
            maintenance: 100,
            quality: 100,
            supplyChain: 100,
            vulnerability: 100,
            license: 100,
          },
        },
        transitively: {
          alerts: [],
          capabilities: [],
          dependencyCount: 5,
          func: 'min',
          lowest: {
            overall: 'pkg:npm/dep@1.0.0',
            maintenance: 'pkg:npm/dep@1.0.0',
            quality: 'pkg:npm/dep@1.0.0',
            supplyChain: 'pkg:npm/dep@1.0.0',
            vulnerability: 'pkg:npm/dep@1.0.0',
            license: 'pkg:npm/dep@1.0.0',
          },
          score: {
            overall: 90,
            maintenance: 90,
            quality: 90,
            supplyChain: 90,
            vulnerability: 90,
            license: 90,
          },
        },
      } as unknown

      const txt = createMarkdownReport(data)
      expect(txt).toContain('This package had no capabilities')
      expect(txt).toContain('This package had no alerts')
    })
  })

  describe('outputPurlsDeepScore', () => {
    it('sets exit code from error result code', async () => {
      const result = {
        ok: false as const,
        message: 'Failed',
        code: 7,
      }
      process.exitCode = undefined
      await outputPurlsDeepScore('pkg:npm/test', result, 'json')
      expect(process.exitCode).toBe(7)
      process.exitCode = undefined
    })

    it('falls back exit code to 1 when result.code missing', async () => {
      const result = {
        ok: false as const,
        message: 'Failed without code',
      }
      process.exitCode = undefined
      await outputPurlsDeepScore('pkg:npm/test', result, 'json')
      expect(process.exitCode).toBe(1)
      process.exitCode = undefined
    })

    it('returns early after fail message in text mode for error result', async () => {
      const result = {
        ok: false as const,
        message: 'fail',
        cause: 'reason',
      }
      // Should not throw / resolve to undefined.
      await expect(
        outputPurlsDeepScore('pkg:npm/test', result as unknown, 'text'),
      ).resolves.toBeUndefined()
    })

    it('renders markdown report on success (lines 29-34)', async () => {
      // Exercises the `outputKind === 'markdown'` branch that emits
      // logger.success + logger.log(md) + return.
      const result = {
        ok: true as const,
        data: nugetDeep.data,
      }
      await expect(
        outputPurlsDeepScore('pkg:nuget/test', result as unknown, 'markdown'),
      ).resolves.toBeUndefined()
    })

    it('renders text fallback on success (lines 36-40)', async () => {
      // Exercises the default text-output branch (logger.log of the data
      // object after the markdown branch returns).
      const result = {
        ok: true as const,
        data: nugetDeep.data,
      }
      await expect(
        outputPurlsDeepScore('pkg:nuget/test', result as unknown, 'text'),
      ).resolves.toBeUndefined()
    })
  })
})
