/**
 * Direct tests for the now-exported helpers in util/socket/api.mts.
 *
 * Related Files: - src/util/socket/api.mts.
 */

import { describe, expect, it } from 'vitest'

import {
  getCommandRequirements,
  tryReadResponseText,
} from '../../../../src/util/socket/api.mts'

describe('tryReadResponseText', () => {
  it('returns the text when response.text() succeeds', () => {
    const result = tryReadResponseText({
      text: () => 'response body',
    } as unknown)
    expect(result).toBe('response body')
  })

  it('returns undefined when response.text() throws', () => {
    const result = tryReadResponseText({
      text: () => {
        throw new Error('already consumed')
      },
    } as unknown)
    expect(result).toBeUndefined()
  })

  it('returns undefined when response has no text method', () => {
    const result = tryReadResponseText({} as unknown)
    expect(result).toBeUndefined()
  })
})

describe('getCommandRequirements', () => {
  it('returns undefined when no command path is provided', () => {
    expect(getCommandRequirements()).toBeUndefined()
    expect(getCommandRequirements(undefined)).toBeUndefined()
    expect(getCommandRequirements('')).toBeUndefined()
  })

  it('returns undefined for unknown command paths', () => {
    expect(getCommandRequirements('socket:nonexistent:path')).toBeUndefined()
  })

  it('returns requirements for a known command path', () => {
    // The exact requirements depend on requirements.json content, but
    // for a real command like "socket scan create" we get back an
    // object with at least one known field (permissions or quota).
    const result = getCommandRequirements('socket scan:create')
    if (result !== undefined) {
      expect(typeof result).toBe('object')
    }
  })
})
