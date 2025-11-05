/**
 * @fileoverview Unit tests for CLI flag utilities.
 *
 * Tests boolean flag checking functions for common CLI options:
 * - getLogLevel() determines logging verbosity (silent/info/debug) with priority handling
 * - Flag checkers: isDebug, isVerbose, isQuiet, isHelp, isJson, isForce, isDryRun
 * - Additional flags: isAll, isChanged, isCoverage, isFix, isStaged, isUpdate, isWatch
 * - Handles arrays of strings (process.argv) and FlagValues objects
 * - Tests flag priority (quiet > debug > verbose) and default values
 * - Validates both long-form flags (--verbose) and flag objects ({ verbose: true })
 */

import {
  getLogLevel,
  isAll,
  isChanged,
  isCoverage,
  isDebug,
  isDryRun,
  isFix,
  isForce,
  isHelp,
  isJson,
  isQuiet,
  isStaged,
  isUpdate,
  isVerbose,
  isWatch,
  type FlagValues,
} from '@socketsecurity/lib/argv/flags'
import { describe, expect, it } from 'vitest'

describe('argv/flags', () => {
  describe('getLogLevel', () => {
    it('should return silent for quiet flag', () => {
      expect(getLogLevel({ quiet: true })).toBe('silent')
    })

    it('should return debug for debug flag', () => {
      expect(getLogLevel({ debug: true })).toBe('debug')
    })

    it('should return verbose for verbose flag', () => {
      expect(getLogLevel({ verbose: true })).toBe('verbose')
    })

    it('should return info by default', () => {
      expect(getLogLevel({})).toBe('info')
    })

    it('should prioritize quiet over debug', () => {
      expect(getLogLevel({ quiet: true, debug: true })).toBe('silent')
    })

    it('should prioritize quiet over verbose', () => {
      expect(getLogLevel({ quiet: true, verbose: true })).toBe('silent')
    })

    it('should prioritize debug over verbose', () => {
      expect(getLogLevel({ debug: true, verbose: true })).toBe('debug')
    })

    it('should work with argv array', () => {
      expect(getLogLevel(['--debug'])).toBe('debug')
      expect(getLogLevel(['--verbose'])).toBe('verbose')
      expect(getLogLevel(['--quiet'])).toBe('silent')
    })
  })

  describe('isAll', () => {
    it('should return true when all flag is set', () => {
      expect(isAll({ all: true })).toBe(true)
    })

    it('should return false when all flag is not set', () => {
      expect(isAll({ all: false })).toBe(false)
      expect(isAll({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isAll(['--all'])).toBe(true)
      expect(isAll(['--other'])).toBe(false)
    })
  })

  describe('isChanged', () => {
    it('should return true when changed flag is set', () => {
      expect(isChanged({ changed: true })).toBe(true)
    })

    it('should return false when changed flag is not set', () => {
      expect(isChanged({ changed: false })).toBe(false)
      expect(isChanged({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isChanged(['--changed'])).toBe(true)
      expect(isChanged([])).toBe(false)
    })
  })

  describe('isCoverage', () => {
    it('should return true for coverage flag', () => {
      expect(isCoverage({ coverage: true })).toBe(true)
    })

    it('should return true for cover flag', () => {
      expect(isCoverage({ cover: true })).toBe(true)
    })

    it('should return false when neither flag is set', () => {
      expect(isCoverage({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isCoverage(['--coverage'])).toBe(true)
      expect(isCoverage(['--cover'])).toBe(true)
      expect(isCoverage([])).toBe(false)
    })
  })

  describe('isDebug', () => {
    it('should return true when debug flag is set', () => {
      expect(isDebug({ debug: true })).toBe(true)
    })

    it('should return false when debug flag is not set', () => {
      expect(isDebug({ debug: false })).toBe(false)
      expect(isDebug({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isDebug(['--debug'])).toBe(true)
      expect(isDebug([])).toBe(false)
    })
  })

  describe('isDryRun', () => {
    it('should return true when dry-run flag is set', () => {
      expect(isDryRun({ 'dry-run': true })).toBe(true)
    })

    it('should return false when dry-run flag is not set', () => {
      expect(isDryRun({ 'dry-run': false })).toBe(false)
      expect(isDryRun({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isDryRun(['--dry-run'])).toBe(true)
      expect(isDryRun([])).toBe(false)
    })
  })

  describe('isFix', () => {
    it('should return true when fix flag is set', () => {
      expect(isFix({ fix: true })).toBe(true)
    })

    it('should return false when fix flag is not set', () => {
      expect(isFix({ fix: false })).toBe(false)
      expect(isFix({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isFix(['--fix'])).toBe(true)
      expect(isFix([])).toBe(false)
    })
  })

  describe('isForce', () => {
    it('should return true when force flag is set', () => {
      expect(isForce({ force: true })).toBe(true)
    })

    it('should return false when force flag is not set', () => {
      expect(isForce({ force: false })).toBe(false)
      expect(isForce({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isForce(['--force'])).toBe(true)
      expect(isForce([])).toBe(false)
    })
  })

  describe('isHelp', () => {
    it('should return true when help flag is set', () => {
      expect(isHelp({ help: true })).toBe(true)
    })

    it('should return false when help flag is not set', () => {
      expect(isHelp({ help: false })).toBe(false)
      expect(isHelp({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isHelp(['--help'])).toBe(true)
      expect(isHelp([])).toBe(false)
    })
  })

  describe('isJson', () => {
    it('should return true when json flag is set', () => {
      expect(isJson({ json: true })).toBe(true)
    })

    it('should return false when json flag is not set', () => {
      expect(isJson({ json: false })).toBe(false)
      expect(isJson({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isJson(['--json'])).toBe(true)
      expect(isJson([])).toBe(false)
    })
  })

  describe('isQuiet', () => {
    it('should return true when quiet flag is set', () => {
      expect(isQuiet({ quiet: true })).toBe(true)
    })

    it('should return false when quiet flag is not set', () => {
      expect(isQuiet({ quiet: false })).toBe(false)
      expect(isQuiet({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isQuiet(['--quiet'])).toBe(true)
      expect(isQuiet([])).toBe(false)
    })
  })

  describe('isQuiet (silent behavior)', () => {
    it('should treat quiet as silent', () => {
      // isQuiet provides the silent behavior
      expect(isQuiet({ quiet: true })).toBe(true)
    })
  })

  describe('isStaged', () => {
    it('should return true when staged flag is set', () => {
      expect(isStaged({ staged: true })).toBe(true)
    })

    it('should return false when staged flag is not set', () => {
      expect(isStaged({ staged: false })).toBe(false)
      expect(isStaged({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isStaged(['--staged'])).toBe(true)
      expect(isStaged([])).toBe(false)
    })
  })

  describe('isUpdate', () => {
    it('should return true when update flag is set', () => {
      expect(isUpdate({ update: true })).toBe(true)
    })

    it('should return false when update flag is not set', () => {
      expect(isUpdate({ update: false })).toBe(false)
      expect(isUpdate({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isUpdate(['--update'])).toBe(true)
      expect(isUpdate([])).toBe(false)
    })
  })

  describe('isVerbose', () => {
    it('should return true when verbose flag is set', () => {
      expect(isVerbose({ verbose: true })).toBe(true)
    })

    it('should return false when verbose flag is not set', () => {
      expect(isVerbose({ verbose: false })).toBe(false)
      expect(isVerbose({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isVerbose(['--verbose'])).toBe(true)
      expect(isVerbose([])).toBe(false)
    })
  })

  describe('isWatch', () => {
    it('should return true when watch flag is set', () => {
      expect(isWatch({ watch: true })).toBe(true)
    })

    it('should return false when watch flag is not set', () => {
      expect(isWatch({ watch: false })).toBe(false)
      expect(isWatch({})).toBe(false)
    })

    it('should work with argv array', () => {
      expect(isWatch(['--watch'])).toBe(true)
      expect(isWatch([])).toBe(false)
    })
  })

  describe('FlagValues type', () => {
    it('should accept all standard flags', () => {
      const flags: FlagValues = {
        quiet: true,
        silent: false,
        verbose: true,
        help: false,
        all: true,
        fix: false,
        force: true,
        'dry-run': false,
        json: true,
        debug: false,
        watch: true,
        coverage: false,
        cover: true,
        update: false,
        staged: true,
        changed: false,
      }
      expect(flags.quiet).toBe(true)
      expect(flags.verbose).toBe(true)
    })

    it('should accept custom flags', () => {
      const flags: FlagValues = {
        customFlag: 'custom-value',
        anotherFlag: 123,
      }
      expect(flags.customFlag).toBe('custom-value')
      expect(flags.anotherFlag).toBe(123)
    })
  })

  describe('edge cases', () => {
    it('should handle empty FlagValues', () => {
      const flags: FlagValues = {}
      expect(isDebug(flags)).toBe(false)
      expect(isVerbose(flags)).toBe(false)
    })

    it('should handle mixed flag types', () => {
      expect(isDebug(['--debug', '--other', 'arg'])).toBe(true)
    })

    it('should handle readonly arrays', () => {
      const args = ['--debug'] as const
      expect(isDebug(args)).toBe(true)
    })
  })
})
