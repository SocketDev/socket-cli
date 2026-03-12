/**
 * Unit tests for reachability analysis flags.
 *
 * Purpose:
 * Tests the reachability analysis flag definitions.
 *
 * Test Coverage:
 * - reachabilityFlags constant
 * - Flag types and defaults
 * - Flag descriptions
 *
 * Related Files:
 * - src/commands/scan/reachability-flags.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import { reachabilityFlags } from '../../../../src/commands/scan/reachability-flags.mts'

describe('reachability-flags', () => {
  describe('reachabilityFlags', () => {
    it('has reachAnalysisMemoryLimit flag', () => {
      expect(reachabilityFlags['reachAnalysisMemoryLimit']).toBeDefined()
      expect(reachabilityFlags['reachAnalysisMemoryLimit']!.type).toBe('number')
      expect(reachabilityFlags['reachAnalysisMemoryLimit']!.default).toBe(8192)
    })

    it('has reachAnalysisTimeout flag', () => {
      expect(reachabilityFlags['reachAnalysisTimeout']).toBeDefined()
      expect(reachabilityFlags['reachAnalysisTimeout']!.type).toBe('number')
      expect(reachabilityFlags['reachAnalysisTimeout']!.default).toBe(0)
    })

    it('has reachConcurrency flag', () => {
      expect(reachabilityFlags['reachConcurrency']).toBeDefined()
      expect(reachabilityFlags['reachConcurrency']!.type).toBe('number')
      expect(reachabilityFlags['reachConcurrency']!.default).toBe(1)
    })

    it('has reachDebug flag', () => {
      expect(reachabilityFlags['reachDebug']).toBeDefined()
      expect(reachabilityFlags['reachDebug']!.type).toBe('boolean')
      expect(reachabilityFlags['reachDebug']!.default).toBe(false)
    })

    it('has reachDisableAnalytics flag', () => {
      expect(reachabilityFlags['reachDisableAnalytics']).toBeDefined()
      expect(reachabilityFlags['reachDisableAnalytics']!.type).toBe('boolean')
      expect(reachabilityFlags['reachDisableAnalytics']!.default).toBe(false)
    })

    it('has reachDisableAnalysisSplitting flag', () => {
      expect(reachabilityFlags['reachDisableAnalysisSplitting']).toBeDefined()
      expect(reachabilityFlags['reachDisableAnalysisSplitting']!.type).toBe(
        'boolean',
      )
      expect(reachabilityFlags['reachDisableAnalysisSplitting']!.default).toBe(
        false,
      )
    })

    it('has reachEcosystems flag with isMultiple', () => {
      expect(reachabilityFlags['reachEcosystems']).toBeDefined()
      expect(reachabilityFlags['reachEcosystems']!.type).toBe('string')
      expect(reachabilityFlags['reachEcosystems']!.isMultiple).toBe(true)
    })

    it('has reachExcludePaths flag with isMultiple', () => {
      expect(reachabilityFlags['reachExcludePaths']).toBeDefined()
      expect(reachabilityFlags['reachExcludePaths']!.type).toBe('string')
      expect(reachabilityFlags['reachExcludePaths']!.isMultiple).toBe(true)
    })

    it('has reachLazyMode flag as hidden', () => {
      expect(reachabilityFlags['reachLazyMode']).toBeDefined()
      expect(reachabilityFlags['reachLazyMode']!.type).toBe('boolean')
      expect(reachabilityFlags['reachLazyMode']!.hidden).toBe(true)
    })

    it('has reachMinSeverity flag', () => {
      expect(reachabilityFlags['reachMinSeverity']).toBeDefined()
      expect(reachabilityFlags['reachMinSeverity']!.type).toBe('string')
      expect(reachabilityFlags['reachMinSeverity']!.default).toBe('')
    })

    it('has reachSkipCache flag', () => {
      expect(reachabilityFlags['reachSkipCache']).toBeDefined()
      expect(reachabilityFlags['reachSkipCache']!.type).toBe('boolean')
      expect(reachabilityFlags['reachSkipCache']!.default).toBe(false)
    })

    it('has reachUseOnlyPregeneratedSboms flag', () => {
      expect(reachabilityFlags['reachUseOnlyPregeneratedSboms']).toBeDefined()
      expect(reachabilityFlags['reachUseOnlyPregeneratedSboms']!.type).toBe(
        'boolean',
      )
      expect(reachabilityFlags['reachUseOnlyPregeneratedSboms']!.default).toBe(
        false,
      )
    })

    it('has reachUseUnreachableFromPrecomputation flag', () => {
      expect(
        reachabilityFlags['reachUseUnreachableFromPrecomputation'],
      ).toBeDefined()
      expect(
        reachabilityFlags['reachUseUnreachableFromPrecomputation']!.type,
      ).toBe('boolean')
      expect(
        reachabilityFlags['reachUseUnreachableFromPrecomputation']!.default,
      ).toBe(false)
    })

    it('all flags have descriptions', () => {
      const flagNames = Object.keys(reachabilityFlags) as Array<
        keyof typeof reachabilityFlags
      >
      for (const flagName of flagNames) {
        expect(reachabilityFlags[flagName]!.description).toBeDefined()
        expect(reachabilityFlags[flagName]!.description!.length).toBeGreaterThan(
          0,
        )
      }
    })
  })
})
