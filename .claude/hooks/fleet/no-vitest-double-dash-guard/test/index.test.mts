/**
 * @file Unit tests for no-vitest-double-dash-guard.
 */

import { describe, expect, it } from 'vitest'

import { vitestDoubleDash } from '../index.mts'

describe('no-vitest-double-dash-guard', () => {
  describe('blocks -- before a path', () => {
    it('pnpm test -- <path>', () => {
      expect(vitestDoubleDash('pnpm test -- test/foo.test.mts')).toBeDefined()
    })

    it('pnpm run test -- <path>', () => {
      expect(
        vitestDoubleDash('pnpm run test -- path/to/foo.test.mts'),
      ).toBeDefined()
    })

    it('node_modules/.bin/vitest run -- <path>', () => {
      expect(
        vitestDoubleDash('node_modules/.bin/vitest run -- foo.test.mts'),
      ).toBeDefined()
    })

    it('bare vitest run -- <path>', () => {
      expect(vitestDoubleDash('vitest run -- foo.test.mts')).toBeDefined()
    })

    it('flags it inside a chained command', () => {
      expect(
        vitestDoubleDash('pnpm build && pnpm test -- foo.test.mts'),
      ).toBeDefined()
    })
  })

  describe('allows clean invocations', () => {
    it('pnpm test <path> (no --)', () => {
      expect(vitestDoubleDash('pnpm test test/foo.test.mts')).toBeUndefined()
    })

    it('node_modules/.bin/vitest run <path> (no --)', () => {
      expect(
        vitestDoubleDash('node_modules/.bin/vitest run test/foo.test.mts'),
      ).toBeUndefined()
    })

    it('a -- with only flags after it is not the path-dropping shape', () => {
      expect(vitestDoubleDash('pnpm test -- --reporter=dot')).toBeUndefined()
    })

    it('does not touch a non-test command with --', () => {
      expect(vitestDoubleDash('pnpm run build -- --watch')).toBeUndefined()
    })

    it('does not touch a non-vitest binary', () => {
      expect(vitestDoubleDash('git log -- path/to/file')).toBeUndefined()
    })

    it('tolerates an unparseable command (fail-open)', () => {
      expect(() => vitestDoubleDash('pnpm test -- "broken')).not.toThrow()
    })
  })
})
