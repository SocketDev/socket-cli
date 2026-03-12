/**
 * Unit tests for CLI constants.
 *
 * Purpose:
 * Tests the CLI interface constants including flags, output formats, and labels.
 *
 * Test Coverage:
 * - CLI flag constants
 * - Output format constants
 * - Fold setting constants
 * - Dry run labels
 * - Command constants
 *
 * Related Files:
 * - constants/cli.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  DRY_RUN_BAILING_NOW,
  DRY_RUN_LABEL,
  DRY_RUN_NOT_SAVING,
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_HELP_FULL,
  FLAG_ID,
  FLAG_JSON,
  FLAG_LOGLEVEL,
  FLAG_MARKDOWN,
  FLAG_ORG,
  FLAG_PIN,
  FLAG_PROD,
  FLAG_QUIET,
  FLAG_SILENT,
  FLAG_TEXT,
  FLAG_VERBOSE,
  FLAG_VERSION,
  FOLD_SETTING_FILE,
  FOLD_SETTING_NONE,
  FOLD_SETTING_PKG,
  FOLD_SETTING_VERSION,
  OUTPUT_JSON,
  OUTPUT_MARKDOWN,
  OUTPUT_TEXT,
  REDACTED,
  SEA_UPDATE_COMMAND,
} from '../../../src/constants/cli.mts'

describe('cli constants', () => {
  describe('flag constants', () => {
    it('has FLAG_CONFIG constant', () => {
      expect(FLAG_CONFIG).toBe('--config')
    })

    it('has FLAG_DRY_RUN constant', () => {
      expect(FLAG_DRY_RUN).toBe('--dry-run')
    })

    it('has FLAG_HELP constant', () => {
      expect(FLAG_HELP).toBe('--help')
    })

    it('has FLAG_HELP_FULL constant', () => {
      expect(FLAG_HELP_FULL).toBe('--help-full')
    })

    it('has FLAG_ID constant', () => {
      expect(FLAG_ID).toBe('--id')
    })

    it('has FLAG_JSON constant', () => {
      expect(FLAG_JSON).toBe('--json')
    })

    it('has FLAG_LOGLEVEL constant', () => {
      expect(FLAG_LOGLEVEL).toBe('--loglevel')
    })

    it('has FLAG_MARKDOWN constant', () => {
      expect(FLAG_MARKDOWN).toBe('--markdown')
    })

    it('has FLAG_ORG constant', () => {
      expect(FLAG_ORG).toBe('--org')
    })

    it('has FLAG_PIN constant', () => {
      expect(FLAG_PIN).toBe('--pin')
    })

    it('has FLAG_PROD constant', () => {
      expect(FLAG_PROD).toBe('--prod')
    })

    it('has FLAG_QUIET constant', () => {
      expect(FLAG_QUIET).toBe('--quiet')
    })

    it('has FLAG_SILENT constant', () => {
      expect(FLAG_SILENT).toBe('--silent')
    })

    it('has FLAG_TEXT constant', () => {
      expect(FLAG_TEXT).toBe('--text')
    })

    it('has FLAG_VERBOSE constant', () => {
      expect(FLAG_VERBOSE).toBe('--verbose')
    })

    it('has FLAG_VERSION constant', () => {
      expect(FLAG_VERSION).toBe('--version')
    })

    it('all flags start with --', () => {
      const flags = [
        FLAG_CONFIG,
        FLAG_DRY_RUN,
        FLAG_HELP,
        FLAG_HELP_FULL,
        FLAG_ID,
        FLAG_JSON,
        FLAG_LOGLEVEL,
        FLAG_MARKDOWN,
        FLAG_ORG,
        FLAG_PIN,
        FLAG_PROD,
        FLAG_QUIET,
        FLAG_SILENT,
        FLAG_TEXT,
        FLAG_VERBOSE,
        FLAG_VERSION,
      ]
      for (const flag of flags) {
        expect(flag.startsWith('--')).toBe(true)
      }
    })
  })

  describe('output format constants', () => {
    it('has OUTPUT_JSON constant', () => {
      expect(OUTPUT_JSON).toBe('json')
    })

    it('has OUTPUT_MARKDOWN constant', () => {
      expect(OUTPUT_MARKDOWN).toBe('markdown')
    })

    it('has OUTPUT_TEXT constant', () => {
      expect(OUTPUT_TEXT).toBe('text')
    })
  })

  describe('fold setting constants', () => {
    it('has FOLD_SETTING_FILE constant', () => {
      expect(FOLD_SETTING_FILE).toBe('file')
    })

    it('has FOLD_SETTING_NONE constant', () => {
      expect(FOLD_SETTING_NONE).toBe('none')
    })

    it('has FOLD_SETTING_PKG constant', () => {
      expect(FOLD_SETTING_PKG).toBe('pkg')
    })

    it('has FOLD_SETTING_VERSION constant', () => {
      expect(FOLD_SETTING_VERSION).toBe('version')
    })
  })

  describe('dry run labels', () => {
    it('has DRY_RUN_LABEL constant', () => {
      expect(DRY_RUN_LABEL).toBe('[DryRun]')
    })

    it('has DRY_RUN_BAILING_NOW constant', () => {
      expect(DRY_RUN_BAILING_NOW).toBe('[DryRun]: Bailing now')
      expect(DRY_RUN_BAILING_NOW).toContain(DRY_RUN_LABEL)
    })

    it('has DRY_RUN_NOT_SAVING constant', () => {
      expect(DRY_RUN_NOT_SAVING).toBe('[DryRun]: Not saving')
      expect(DRY_RUN_NOT_SAVING).toContain(DRY_RUN_LABEL)
    })
  })

  describe('command constants', () => {
    it('has SEA_UPDATE_COMMAND constant', () => {
      expect(SEA_UPDATE_COMMAND).toBe('self-update')
    })
  })

  describe('redaction constants', () => {
    it('has REDACTED constant', () => {
      expect(REDACTED).toBe('<redacted>')
    })
  })
})
