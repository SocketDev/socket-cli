/**
 * Unit tests for MCP tool argument validation.
 *
 * Tool arguments are untrusted: the model that emits them can be steered by any
 * content it has read. These predicates are what stands between a steered
 * argument and an outbound URL, so the negative cases matter more than the
 * positive ones.
 *
 * Related Files: - src/commands/mcp/tool-input.mts -
 * src/commands/mcp/tool-args.mts
 */

import { describe, expect, it } from 'vitest'

import {
  readToolBoolean,
  readToolNumber,
  readToolString,
} from '../../../../src/commands/mcp/tool-args.mts'
import {
  isBoundedToolString,
  isSocketBlobHash,
  isSocketOrgSlug,
  truncateToolLabel,
} from '../../../../src/commands/mcp/tool-input.mts'

// Pinned literal rather than the module's own constant: an expected value taken
// from the code under test cannot catch that constant changing.
const EXPECTED_MAX_TOOL_LABEL_LENGTH = 256

describe('isSocketOrgSlug', () => {
  it.each(['my-org', 'socket', 'a1', 'my.org', 'my_org', 'Acme-2'])(
    'accepts %s',
    slug => {
      expect(isSocketOrgSlug(slug)).toBe(true)
    },
  )

  it.each([
    ['empty', ''],
    ['path traversal', '../../admin'],
    ['a slash', 'org/alerts'],
    ['a query smuggle', 'org?per_page=5000'],
    ['a fragment', 'org#frag'],
    ['whitespace', 'my org'],
    ['a newline (header smuggling)', 'org\nX-Evil: 1'],
    ['a leading separator', '-org'],
    ['a trailing separator', 'org-'],
    ['an encoded slash', 'org%2Falerts'],
    ['a full URL', 'https://evil.example.com'],
  ])('rejects %s', (_label, slug) => {
    expect(isSocketOrgSlug(slug)).toBe(false)
  })

  it('rejects a slug longer than 100 characters', () => {
    expect(isSocketOrgSlug('a'.repeat(101))).toBe(false)
  })
})

describe('isSocketBlobHash', () => {
  it('accepts a Q-prefixed single-blob hash', () => {
    expect(isSocketBlobHash(`Q${'a'.repeat(20)}`)).toBe(true)
  })

  it('accepts an S-prefixed chunked hash', () => {
    expect(isSocketBlobHash(`S${'a'.repeat(20)}`)).toBe(true)
  })

  it('accepts URL-safe base64 characters', () => {
    expect(isSocketBlobHash(`Q${'a-b_c9'.repeat(4)}`)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['no Q/S prefix', 'X'.repeat(20)],
    ['too short', 'Qabc'],
    ['a path traversal', `Q${'a'.repeat(15)}/../etc/passwd`],
    ['a slash', `Q${'a'.repeat(15)}/x`],
    ['a plus (non URL-safe base64)', `Q${'a'.repeat(15)}+x`],
    ['whitespace', `Q${'a'.repeat(15)} x`],
  ])('rejects %s', (_label, hash) => {
    expect(isSocketBlobHash(hash)).toBe(false)
  })

  it('rejects a hash beyond the length cap', () => {
    expect(isSocketBlobHash(`Q${'a'.repeat(600)}`)).toBe(false)
  })
})

describe('isBoundedToolString', () => {
  it('accepts a value at the limit', () => {
    expect(isBoundedToolString('abc', 3)).toBe(true)
  })

  it('rejects a value past the limit', () => {
    expect(isBoundedToolString('abcd', 3)).toBe(false)
  })

  it('rejects an empty value', () => {
    expect(isBoundedToolString('', 3)).toBe(false)
  })
})

describe('truncateToolLabel', () => {
  it('leaves a short label untouched', () => {
    expect(truncateToolLabel('lib/index.js')).toBe('lib/index.js')
  })

  it('clips a long label and marks the clip', () => {
    const result = truncateToolLabel(
      'a'.repeat(EXPECTED_MAX_TOOL_LABEL_LENGTH + 50),
    )
    expect(result).toHaveLength(EXPECTED_MAX_TOOL_LABEL_LENGTH + 1)
    expect(result.endsWith('…')).toBe(true)
  })

  it('honors an explicit limit', () => {
    expect(truncateToolLabel('abcdef', 3)).toBe('abc…')
  })
})

describe('tool argument readers', () => {
  it('reads a present string', () => {
    expect(readToolString({ a: 'x' }, 'a')).toBe('x')
  })

  it('treats a wrong-typed or empty string as absent', () => {
    expect(readToolString({ a: 5 }, 'a')).toBeUndefined()
    expect(readToolString({ a: '' }, 'a')).toBeUndefined()
    expect(readToolString({}, 'a')).toBeUndefined()
  })

  it('reads a finite number only', () => {
    expect(readToolNumber({ a: 10 }, 'a')).toBe(10)
    expect(readToolNumber({ a: Number.NaN }, 'a')).toBeUndefined()
    expect(readToolNumber({ a: Number.POSITIVE_INFINITY }, 'a')).toBeUndefined()
    expect(readToolNumber({ a: '10' }, 'a')).toBeUndefined()
  })

  it('reads a real boolean only', () => {
    expect(readToolBoolean({ a: false }, 'a')).toBe(false)
    expect(readToolBoolean({ a: 'true' }, 'a')).toBeUndefined()
    expect(readToolBoolean({}, 'a')).toBeUndefined()
  })

  it('does not read through the prototype chain', () => {
    expect(readToolString({}, 'toString')).toBeUndefined()
    expect(readToolString({}, 'constructor')).toBeUndefined()
  })
})
