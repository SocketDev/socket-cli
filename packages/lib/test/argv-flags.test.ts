/**
 * @fileoverview Unit tests for CLI flag detection utilities.
 *
 * Tests command-line flag checker functions:
 * - COMMON_FLAGS constant with standard CLI flags
 * - Flag detectors: isHelp(), isVerbose(), isQuiet(), isDebug(), isForce()
 * - Mode flags: isDryRun(), isFix(), isUpdate(), isCoverage(), isJson()
 * - Context flags: isAll(), isChanged(), isStaged()
 * - getLogLevel() extracts log level from parsed args
 * Used by Socket CLI for command-line argument interpretation.
 */

import {
  COMMON_FLAGS,
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
    it('should return silent for quiet flags', () => {
      expect(getLogLevel({ quiet: true })).toBe('silent')
      expect(getLogLevel({ silent: true })).toBe('silent')
    })

    it('should return debug for debug flag', () => {
      expect(getLogLevel({ debug: true })).toBe('debug')
    })

    it('should return verbose for verbose flag', () => {
      expect(getLogLevel({ verbose: true })).toBe('verbose')
    })

    it('should return info as default', () => {
      expect(getLogLevel({})).toBe('info')
      expect(getLogLevel()).toBe('info')
    })

    it('should prioritize quiet over debug', () => {
      expect(getLogLevel({ quiet: true, debug: true })).toBe('silent')
    })

    it('should prioritize debug over verbose', () => {
      expect(getLogLevel({ debug: true, verbose: true })).toBe('debug')
    })

    it('should handle array input', () => {
      expect(getLogLevel(['--quiet'])).toBe('silent')
      expect(getLogLevel(['--debug'])).toBe('debug')
      expect(getLogLevel(['--verbose'])).toBe('verbose')
    })
  })

  describe('isAll', () => {
    it('should return true for all flag in object', () => {
      expect(isAll({ all: true })).toBe(true)
    })

    it('should return false when all flag not set', () => {
      expect(isAll({})).toBe(false)
      expect(isAll({ all: false })).toBe(false)
    })

    it('should handle array input', () => {
      expect(isAll(['--all'])).toBe(true)
      expect(isAll([])).toBe(false)
    })

    it('should handle undefined input', () => {
      const result = isAll(undefined)
      expect(typeof result).toBe('boolean')
    })
  })

  describe('isChanged', () => {
    it('should return true for changed flag', () => {
      expect(isChanged({ changed: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isChanged({})).toBe(false)
    })

    it('should handle array input', () => {
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

    it('should return false when not set', () => {
      expect(isCoverage({})).toBe(false)
    })

    it('should handle array input with coverage', () => {
      expect(isCoverage(['--coverage'])).toBe(true)
    })

    it('should handle array input with cover', () => {
      expect(isCoverage(['--cover'])).toBe(true)
    })

    it('should return false for empty array', () => {
      expect(isCoverage([])).toBe(false)
    })
  })

  describe('isDebug', () => {
    it('should return true for debug flag', () => {
      expect(isDebug({ debug: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isDebug({})).toBe(false)
    })

    it('should handle array input', () => {
      expect(isDebug(['--debug'])).toBe(true)
      expect(isDebug([])).toBe(false)
    })
  })

  describe('isDryRun', () => {
    it('should return true for dry-run flag', () => {
      expect(isDryRun({ 'dry-run': true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isDryRun({})).toBe(false)
    })

    it('should handle array input', () => {
      expect(isDryRun(['--dry-run'])).toBe(true)
      expect(isDryRun([])).toBe(false)
    })
  })

  describe('isFix', () => {
    it('should return true for fix flag', () => {
      expect(isFix({ fix: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isFix({})).toBe(false)
    })

    it('should handle array input', () => {
      expect(isFix(['--fix'])).toBe(true)
      expect(isFix([])).toBe(false)
    })
  })

  describe('isForce', () => {
    it('should return true for force flag', () => {
      expect(isForce({ force: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isForce({})).toBe(false)
    })

    it('should handle array input', () => {
      expect(isForce(['--force'])).toBe(true)
      expect(isForce([])).toBe(false)
    })
  })

  describe('isHelp', () => {
    it('should return true for help flag', () => {
      expect(isHelp({ help: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isHelp({})).toBe(false)
    })

    it('should handle --help in array', () => {
      expect(isHelp(['--help'])).toBe(true)
    })

    it('should handle -h short flag in array', () => {
      expect(isHelp(['-h'])).toBe(true)
    })

    it('should return false for empty array', () => {
      expect(isHelp([])).toBe(false)
    })
  })

  describe('isJson', () => {
    it('should return true for json flag', () => {
      expect(isJson({ json: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isJson({})).toBe(false)
    })

    it('should handle array input', () => {
      expect(isJson(['--json'])).toBe(true)
      expect(isJson([])).toBe(false)
    })
  })

  describe('isQuiet', () => {
    it('should return true for quiet flag', () => {
      expect(isQuiet({ quiet: true })).toBe(true)
    })

    it('should return true for silent flag', () => {
      expect(isQuiet({ silent: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isQuiet({})).toBe(false)
    })

    it('should handle --quiet in array', () => {
      expect(isQuiet(['--quiet'])).toBe(true)
    })

    it('should handle --silent in array', () => {
      expect(isQuiet(['--silent'])).toBe(true)
    })

    it('should return false for empty array', () => {
      expect(isQuiet([])).toBe(false)
    })
  })

  describe('isStaged', () => {
    it('should return true for staged flag', () => {
      expect(isStaged({ staged: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isStaged({})).toBe(false)
    })

    it('should handle array input', () => {
      expect(isStaged(['--staged'])).toBe(true)
      expect(isStaged([])).toBe(false)
    })
  })

  describe('isUpdate', () => {
    it('should return true for update flag', () => {
      expect(isUpdate({ update: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isUpdate({})).toBe(false)
    })

    it('should handle --update in array', () => {
      expect(isUpdate(['--update'])).toBe(true)
    })

    it('should handle -u short flag in array', () => {
      expect(isUpdate(['-u'])).toBe(true)
    })

    it('should return false for empty array', () => {
      expect(isUpdate([])).toBe(false)
    })
  })

  describe('isVerbose', () => {
    it('should return true for verbose flag', () => {
      expect(isVerbose({ verbose: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isVerbose({})).toBe(false)
    })

    it('should handle array input', () => {
      expect(isVerbose(['--verbose'])).toBe(true)
      expect(isVerbose([])).toBe(false)
    })
  })

  describe('isWatch', () => {
    it('should return true for watch flag', () => {
      expect(isWatch({ watch: true })).toBe(true)
    })

    it('should return false when not set', () => {
      expect(isWatch({})).toBe(false)
    })

    it('should handle --watch in array', () => {
      expect(isWatch(['--watch'])).toBe(true)
    })

    it('should handle -w short flag in array', () => {
      expect(isWatch(['-w'])).toBe(true)
    })

    it('should return false for empty array', () => {
      expect(isWatch([])).toBe(false)
    })
  })

  describe('COMMON_FLAGS', () => {
    it('should be defined', () => {
      expect(COMMON_FLAGS).toBeDefined()
      expect(typeof COMMON_FLAGS).toBe('object')
    })

    it('should have all flag defined', () => {
      expect(COMMON_FLAGS.all).toBeDefined()
      expect(COMMON_FLAGS.all.type).toBe('boolean')
      expect(COMMON_FLAGS.all.default).toBe(false)
    })

    it('should have changed flag defined', () => {
      expect(COMMON_FLAGS.changed).toBeDefined()
      expect(COMMON_FLAGS.changed.type).toBe('boolean')
    })

    it('should have coverage flag defined', () => {
      expect(COMMON_FLAGS.coverage).toBeDefined()
      expect(COMMON_FLAGS.coverage.type).toBe('boolean')
    })

    it('should have debug flag defined', () => {
      expect(COMMON_FLAGS.debug).toBeDefined()
      expect(COMMON_FLAGS.debug.type).toBe('boolean')
    })

    it('should have dry-run flag defined', () => {
      expect(COMMON_FLAGS['dry-run']).toBeDefined()
      expect(COMMON_FLAGS['dry-run'].type).toBe('boolean')
    })

    it('should have fix flag defined', () => {
      expect(COMMON_FLAGS.fix).toBeDefined()
      expect(COMMON_FLAGS.fix.type).toBe('boolean')
    })

    it('should have force flag defined', () => {
      expect(COMMON_FLAGS.force).toBeDefined()
      expect(COMMON_FLAGS.force.type).toBe('boolean')
    })

    it('should have help flag with short alias', () => {
      expect(COMMON_FLAGS.help).toBeDefined()
      expect(COMMON_FLAGS.help.type).toBe('boolean')
      expect(COMMON_FLAGS.help.short).toBe('h')
    })

    it('should have json flag defined', () => {
      expect(COMMON_FLAGS.json).toBeDefined()
      expect(COMMON_FLAGS.json.type).toBe('boolean')
    })

    it('should have quiet flag with short alias', () => {
      expect(COMMON_FLAGS.quiet).toBeDefined()
      expect(COMMON_FLAGS.quiet.type).toBe('boolean')
      expect(COMMON_FLAGS.quiet.short).toBe('q')
    })

    it('should have silent flag defined', () => {
      expect(COMMON_FLAGS.silent).toBeDefined()
      expect(COMMON_FLAGS.silent.type).toBe('boolean')
    })

    it('should have staged flag defined', () => {
      expect(COMMON_FLAGS.staged).toBeDefined()
      expect(COMMON_FLAGS.staged.type).toBe('boolean')
    })

    it('should have update flag with short alias', () => {
      expect(COMMON_FLAGS.update).toBeDefined()
      expect(COMMON_FLAGS.update.type).toBe('boolean')
      expect(COMMON_FLAGS.update.short).toBe('u')
    })

    it('should have verbose flag with short alias', () => {
      expect(COMMON_FLAGS.verbose).toBeDefined()
      expect(COMMON_FLAGS.verbose.type).toBe('boolean')
      expect(COMMON_FLAGS.verbose.short).toBe('v')
    })

    it('should have watch flag with short alias', () => {
      expect(COMMON_FLAGS.watch).toBeDefined()
      expect(COMMON_FLAGS.watch.type).toBe('boolean')
      expect(COMMON_FLAGS.watch.short).toBe('w')
    })

    it('should have descriptions for all flags', () => {
      for (const { 1: config } of Object.entries(COMMON_FLAGS)) {
        expect(config.description).toBeDefined()
        expect(typeof config.description).toBe('string')
        expect(config.description.length).toBeGreaterThan(0)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle truthy values as boolean true', () => {
      // @ts-expect-error - Testing runtime coercion of non-boolean values
      expect(isDebug({ debug: 1 } as FlagValues)).toBe(true)
      // @ts-expect-error - Testing runtime coercion of non-boolean values
      expect(isVerbose({ verbose: 'yes' } as FlagValues)).toBe(true)
    })

    it('should handle falsy values as boolean false', () => {
      // @ts-expect-error - Testing runtime coercion of non-boolean values
      expect(isDebug({ debug: 0 } as FlagValues)).toBe(false)
      // @ts-expect-error - Testing runtime coercion of non-boolean values
      expect(isDebug({ debug: '' } as FlagValues)).toBe(false)
    })

    it('should handle multiple flags in array', () => {
      expect(isDebug(['--verbose', '--debug', '--quiet'])).toBe(true)
      expect(isVerbose(['--verbose', '--debug'])).toBe(true)
    })

    it('should handle flags with values in array', () => {
      expect(isJson(['--json', 'output.json'])).toBe(true)
      expect(isForce(['--force', 'true'])).toBe(true)
    })
  })

  describe('integration', () => {
    it('should work with combined flags object', () => {
      const flags: FlagValues = {
        debug: true,
        verbose: true,
        json: true,
        force: true,
      }

      expect(isDebug(flags)).toBe(true)
      expect(isVerbose(flags)).toBe(true)
      expect(isJson(flags)).toBe(true)
      expect(isForce(flags)).toBe(true)
      expect(isQuiet(flags)).toBe(false)
    })

    it('should work with combined flags array', () => {
      const argv = ['--debug', '--verbose', '--json']

      expect(isDebug(argv)).toBe(true)
      expect(isVerbose(argv)).toBe(true)
      expect(isJson(argv)).toBe(true)
      expect(isQuiet(argv)).toBe(false)
    })

    it('should provide correct log level for various combinations', () => {
      expect(getLogLevel({ quiet: true, debug: true })).toBe('silent')
      expect(getLogLevel({ debug: true, verbose: false })).toBe('debug')
      expect(getLogLevel({ verbose: true, debug: false })).toBe('verbose')
      expect(getLogLevel({ verbose: false, debug: false })).toBe('info')
    })
  })
})
