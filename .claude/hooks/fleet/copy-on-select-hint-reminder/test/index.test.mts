/**
 * @file Unit tests for copy-on-select-hint-reminder.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  copyHint,
  copyOnSelectDisabled,
  isMouseReportingTerminal,
} from '../index.mts'

describe('copy-on-select-hint-reminder', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'copy-hint-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true })
  })

  function writeConfig(value: unknown): string {
    const p = path.join(tmpDir, '.claude.json')
    writeFileSync(p, JSON.stringify({ copyOnSelect: value, other: 1 }), 'utf8')
    return p
  }

  describe('copyOnSelectDisabled', () => {
    it('is true only when copyOnSelect is explicitly false', () => {
      expect(copyOnSelectDisabled(writeConfig(false))).toBe(true)
    })

    it('is false when copyOnSelect is true', () => {
      expect(copyOnSelectDisabled(writeConfig(true))).toBe(false)
    })

    it('is false when the config file is absent', () => {
      expect(copyOnSelectDisabled(path.join(tmpDir, 'nope.json'))).toBe(false)
    })

    it('is false on malformed JSON', () => {
      const p = path.join(tmpDir, '.claude.json')
      writeFileSync(p, '{ not valid', 'utf8')
      expect(copyOnSelectDisabled(p)).toBe(false)
    })
  })

  describe('isMouseReportingTerminal', () => {
    it('recognizes iTerm.app', () => {
      expect(isMouseReportingTerminal('iTerm.app')).toBe(true)
    })

    it('recognizes Apple_Terminal', () => {
      expect(isMouseReportingTerminal('Apple_Terminal')).toBe(true)
    })

    it('is false for an unknown terminal', () => {
      expect(isMouseReportingTerminal('some-other-term')).toBe(false)
    })

    it('is false for undefined TERM_PROGRAM', () => {
      expect(isMouseReportingTerminal(undefined)).toBe(false)
    })
  })

  describe('copyHint', () => {
    it('returns the Option-drag hint when both conditions hold', () => {
      const hint = copyHint(writeConfig(false), 'iTerm.app')
      expect(hint).toBeDefined()
      expect(hint).toContain('Option')
    })

    it('is undefined when copyOnSelect is on', () => {
      expect(copyHint(writeConfig(true), 'iTerm.app')).toBeUndefined()
    })

    it('is undefined in a non-mouse-reporting terminal', () => {
      expect(copyHint(writeConfig(false), 'dumb-term')).toBeUndefined()
    })

    it('is undefined when neither holds', () => {
      expect(copyHint(writeConfig(true), 'dumb-term')).toBeUndefined()
    })
  })
})
