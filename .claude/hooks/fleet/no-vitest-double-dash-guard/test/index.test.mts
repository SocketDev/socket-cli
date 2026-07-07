/**
 * @file Unit tests for no-vitest-double-dash-guard.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { vitestDoubleDash } from '../index.mts'

describe('no-vitest-double-dash-guard', () => {
  describe('blocks -- before a path', () => {
    it('pnpm test -- <path>', () => {
      assert.notStrictEqual(
        vitestDoubleDash('pnpm test -- test/foo.test.mts'),
        undefined,
      )
    })

    it('pnpm run test -- <path>', () => {
      assert.notStrictEqual(
        vitestDoubleDash('pnpm run test -- path/to/foo.test.mts'),
        undefined,
      )
    })

    it('node_modules/.bin/vitest run -- <path>', () => {
      assert.notStrictEqual(
        vitestDoubleDash('node_modules/.bin/vitest run -- foo.test.mts'),
        undefined,
      )
    })

    it('bare vitest run -- <path>', () => {
      assert.notStrictEqual(
        vitestDoubleDash('vitest run -- foo.test.mts'),
        undefined,
      )
    })

    it('flags it inside a chained command', () => {
      assert.notStrictEqual(
        vitestDoubleDash('pnpm build && pnpm test -- foo.test.mts'),
        undefined,
      )
    })
  })

  describe('allows clean invocations', () => {
    it('pnpm test <path> (no --)', () => {
      assert.strictEqual(
        vitestDoubleDash('pnpm test test/foo.test.mts'),
        undefined,
      )
    })

    it('node_modules/.bin/vitest run <path> (no --)', () => {
      assert.strictEqual(
        vitestDoubleDash('node_modules/.bin/vitest run test/foo.test.mts'),
        undefined,
      )
    })

    it('a -- with only flags after it is not the path-dropping shape', () => {
      assert.strictEqual(
        vitestDoubleDash('pnpm test -- --reporter=dot'),
        undefined,
      )
    })

    it('does not touch a non-test command with --', () => {
      assert.strictEqual(vitestDoubleDash('pnpm run build -- --watch'), undefined)
    })

    it('does not touch a non-vitest binary', () => {
      assert.strictEqual(vitestDoubleDash('git log -- path/to/file'), undefined)
    })

    it('tolerates an unparseable command (fail-open)', () => {
      assert.doesNotThrow(() => vitestDoubleDash('pnpm test -- "broken'))
    })
  })
})
