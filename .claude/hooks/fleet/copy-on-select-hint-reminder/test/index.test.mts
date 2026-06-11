/**
 * @file Unit tests for copy-on-select-hint-reminder.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

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
      assert.strictEqual(copyOnSelectDisabled(writeConfig(false)), true)
    })

    it('is false when copyOnSelect is true', () => {
      assert.strictEqual(copyOnSelectDisabled(writeConfig(true)), false)
    })

    it('is false when the config file is absent', () => {
      assert.strictEqual(
        copyOnSelectDisabled(path.join(tmpDir, 'nope.json')),
        false,
      )
    })

    it('is false on malformed JSON', () => {
      const p = path.join(tmpDir, '.claude.json')
      writeFileSync(p, '{ not valid', 'utf8')
      assert.strictEqual(copyOnSelectDisabled(p), false)
    })
  })

  describe('isMouseReportingTerminal', () => {
    it('recognizes iTerm.app', () => {
      assert.strictEqual(isMouseReportingTerminal('iTerm.app'), true)
    })

    it('recognizes Apple_Terminal', () => {
      assert.strictEqual(isMouseReportingTerminal('Apple_Terminal'), true)
    })

    it('is false for an unknown terminal', () => {
      assert.strictEqual(isMouseReportingTerminal('some-other-term'), false)
    })

    it('is false for undefined TERM_PROGRAM', () => {
      assert.strictEqual(isMouseReportingTerminal(undefined), false)
    })
  })

  describe('copyHint', () => {
    it('returns the Option-drag hint when both conditions hold', () => {
      const hint = copyHint(writeConfig(false), 'iTerm.app')
      assert.notStrictEqual(hint, undefined)
      assert.ok(hint!.includes('Option'))
    })

    it('is undefined when copyOnSelect is on', () => {
      assert.strictEqual(copyHint(writeConfig(true), 'iTerm.app'), undefined)
    })

    it('is undefined in a non-mouse-reporting terminal', () => {
      assert.strictEqual(copyHint(writeConfig(false), 'dumb-term'), undefined)
    })

    it('is undefined when neither holds', () => {
      assert.strictEqual(copyHint(writeConfig(true), 'dumb-term'), undefined)
    })
  })
})
