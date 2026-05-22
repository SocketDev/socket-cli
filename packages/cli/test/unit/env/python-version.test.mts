/**
 * Unit tests for Python version getter.
 *
 * Related Files: - src/env/python-version.mts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getPythonVersion } from '../../../src/env/python-version.mts'

describe('env/python-version', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env['INLINED_PYTHON_VERSION']
  })

  afterEach(() => {
    if (original !== undefined) {
      process.env['INLINED_PYTHON_VERSION'] = original
    } else {
      delete process.env['INLINED_PYTHON_VERSION']
    }
  })

  describe('getPythonVersion', () => {
    it('returns the version string when env is set', () => {
      process.env['INLINED_PYTHON_VERSION'] = '3.12.5'
      expect(getPythonVersion()).toBe('3.12.5')
    })
  })

})
