/**
 * @file Unit tests for the shared bypass-comment scanner (lib/comment-markers).
 *   Exercised directly with a fake RuleContext rather than through the
 *   RuleTester — the helper is pure (source text + node line in → boolean out),
 *   so a synthetic context is faster and more precise than a fixture lint.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { makeBypassChecker } from '../lib/comment-markers.mts'

// Minimal RuleContext stand-in: exposes the source text via getSourceCode().
function ctx(source: string): {
  getSourceCode: () => { getText: () => string }
} {
  return { getSourceCode: () => ({ getText: () => source }) }
}

// A node carrying a 1-based start line, as oxlint exposes via `loc`.
function nodeOnLine(line: number): { loc: { start: { line: number } } } {
  return { loc: { start: { line } } }
}

const MARKER = /socket-hook:\s*allow\s+sample/

describe('lib/comment-markers makeBypassChecker', () => {
  test('marker on the node’s own line (trailing comment) → bypassed', () => {
    const src = 'const x = doThing() // socket-hook: allow sample\n'
    const has = makeBypassChecker(ctx(src) as never, MARKER)
    assert.equal(has(nodeOnLine(1) as never), true)
  })

  test('marker on the line directly above → bypassed', () => {
    const src = '// socket-hook: allow sample\nconst x = doThing()\n'
    const has = makeBypassChecker(ctx(src) as never, MARKER)
    assert.equal(has(nodeOnLine(2) as never), true)
  })

  test('marker in a contiguous leading-comment block (2 lines up) → bypassed', () => {
    const src =
      '// socket-hook: allow sample\n// continuation note\nconst x = doThing()\n'
    const has = makeBypassChecker(ctx(src) as never, MARKER)
    assert.equal(has(nodeOnLine(3) as never), true)
  })

  test('no marker anywhere → not bypassed', () => {
    const src = '// unrelated comment\nconst x = doThing()\n'
    const has = makeBypassChecker(ctx(src) as never, MARKER)
    assert.equal(has(nodeOnLine(2) as never), false)
  })

  test('marker separated from the node by a code line → not bypassed', () => {
    const src =
      '// socket-hook: allow sample\nconst unrelated = 1\nconst x = doThing()\n'
    const has = makeBypassChecker(ctx(src) as never, MARKER)
    assert.equal(has(nodeOnLine(3) as never), false)
  })

  test('marker too far above (beyond the leading-block window) → not bypassed', () => {
    const src =
      '// socket-hook: allow sample\n//\n//\n//\nconst x = doThing()\n'
    const has = makeBypassChecker(ctx(src) as never, MARKER)
    assert.equal(has(nodeOnLine(5) as never), false)
  })

  test('falls back to range offset when loc is absent', () => {
    const src = '// socket-hook: allow sample\nconst x = doThing()\n'
    const has = makeBypassChecker(ctx(src) as never, MARKER)
    // Node on line 2 via range: offset of `const` is after the first newline.
    const offset = src.indexOf('const')
    assert.equal(has({ range: [offset, offset + 5] } as never), true)
  })

  test('returns false when the node has no position info', () => {
    const src = '// socket-hook: allow sample\nconst x = doThing()\n'
    const has = makeBypassChecker(ctx(src) as never, MARKER)
    assert.equal(has({} as never), false)
  })
})
