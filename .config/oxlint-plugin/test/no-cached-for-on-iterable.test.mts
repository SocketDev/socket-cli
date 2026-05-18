/**
 * @fileoverview Unit tests for socket/no-cached-for-on-iterable.
 *
 * The rule catches the silent-no-op bug where the fleet's canonical
 * cached-length `for (let i = 0, { length } = X; …)` loop is applied
 * to a Set / Map / Iterable instead of an array. The 4 fleet
 * incidents that motivated the rule all had a clear `new Set(...)`
 * or `: Set<string>` annotation in scope; tests cover those signals
 * plus a few negatives (arrays, unknown bindings) where the rule
 * must stay silent to avoid nagging on the canonical shape.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-cached-for-on-iterable.mts'

describe('socket/no-cached-for-on-iterable', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-cached-for-on-iterable', rule, {
      valid: [
        {
          name: 'array literal binding — cached-for is correct',
          code:
            'const arr = [1, 2, 3]\n' +
            'for (let i = 0, { length } = arr; i < length; i += 1) {\n' +
            '  const item = arr[i]!\n' +
            '  void item\n' +
            '}\n',
        },
        {
          name: 'T[] annotation — cached-for is correct',
          code:
            'const arr: string[] = []\n' +
            'for (let i = 0, { length } = arr; i < length; i += 1) {\n' +
            '  void arr[i]\n' +
            '}\n',
        },
        {
          name: 'Array<T> annotation — cached-for is correct',
          code:
            'const arr: Array<number> = []\n' +
            'for (let i = 0, { length } = arr; i < length; i += 1) {\n' +
            '  void arr[i]\n' +
            '}\n',
        },
        {
          name: 'Array.from materialization — cached-for is correct',
          code:
            'const set = new Set<string>()\n' +
            'const arr = Array.from(set)\n' +
            'for (let i = 0, { length } = arr; i < length; i += 1) {\n' +
            '  void arr[i]\n' +
            '}\n',
        },
        {
          name: 'Object.keys materialization — cached-for is correct',
          code:
            'const obj = { a: 1, b: 2 }\n' +
            'const keys = Object.keys(obj)\n' +
            'for (let i = 0, { length } = keys; i < length; i += 1) {\n' +
            '  void keys[i]\n' +
            '}\n',
        },
        {
          name: 'unknown binding (no signal) — skip silently',
          code:
            'declare const things: unknown\n' +
            'for (let i = 0, { length } = (things as any); i < length; i += 1) {\n' +
            '  void i\n' +
            '}\n',
        },
        {
          name: 'for...of over a Set — not a cached-for, no finding',
          code:
            'const set = new Set<string>()\n' +
            'for (const item of set) {\n' +
            '  void item\n' +
            '}\n',
        },
        {
          name: 'plain for without the {length} destructure — not the shape',
          code:
            'const set = new Set<string>()\n' +
            'for (let i = 0; i < 10; i += 1) {\n' +
            '  void i\n' +
            '}\n',
        },
        {
          name: 'set.size read is correct — not flagged',
          code:
            'const items = new Set<string>()\n' +
            'const n = items.size\n' +
            'void n\n',
        },
        {
          name: 'map[someKey] with non-numeric-looking identifier is left alone',
          // The rule deliberately stays conservative: `map[someKey]`
          // could be a typo for `map.get(someKey)`, but it could also
          // be a Record / plain-object access aliased through Map<>.
          // Only flag when the index strongly looks like a counter
          // (i / j / k / index / etc.).
          code:
            'declare const m: Map<string, number>\n' +
            'declare const someKey: string\n' +
            'const v = m[someKey]\n' +
            'void v\n',
        },
      ],
      invalid: [
        {
          name: 'new Set() binding — bare init (cached-for + indexed body)',
          code:
            'const items = new Set()\n' +
            'for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '  const item = items[i]!\n' +
            '  void item\n' +
            '}\n',
          // Both findings fire: the loop shape AND the items[i] read.
          errors: [
            { messageId: 'noCachedForOnIterable' },
            { messageId: 'indexedAccessOnIterable' },
          ],
        },
        {
          name: 'Set<string> annotation (cached-for + indexed body)',
          code:
            'declare const items: Set<string>\n' +
            'for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '  void items[i]\n' +
            '}\n',
          errors: [
            { messageId: 'noCachedForOnIterable' },
            { messageId: 'indexedAccessOnIterable' },
          ],
        },
        {
          name: 'ReadonlySet<string> annotation',
          code:
            'declare const items: ReadonlySet<string>\n' +
            'for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '  void items[i]\n' +
            '}\n',
          errors: [
            { messageId: 'noCachedForOnIterable' },
            { messageId: 'indexedAccessOnIterable' },
          ],
        },
        {
          name: 'new Map() binding',
          code:
            'const m = new Map<string, number>()\n' +
            'for (let i = 0, { length } = m; i < length; i += 1) {\n' +
            '  void m[i]\n' +
            '}\n',
          errors: [
            { messageId: 'noCachedForOnIterable' },
            { messageId: 'indexedAccessOnIterable' },
          ],
        },
        {
          name: 'Map<K, V> annotation',
          code:
            'declare const m: Map<string, number>\n' +
            'for (let i = 0, { length } = m; i < length; i += 1) {\n' +
            '  void m[i]\n' +
            '}\n',
          errors: [
            { messageId: 'noCachedForOnIterable' },
            { messageId: 'indexedAccessOnIterable' },
          ],
        },
        {
          name: 'WeakSet<T> annotation',
          code:
            'declare const items: WeakSet<object>\n' +
            'for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '  void i\n' +
            '}\n',
          errors: [{ messageId: 'noCachedForOnIterable' }],
        },
        {
          name: 'Iterable<T> annotation',
          code:
            'declare const items: Iterable<string>\n' +
            'for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '  void i\n' +
            '}\n',
          errors: [{ messageId: 'noCachedForOnIterable' }],
        },
        {
          name: 'IterableIterator<T> annotation',
          code:
            'declare const items: IterableIterator<string>\n' +
            'for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '  void i\n' +
            '}\n',
          errors: [{ messageId: 'noCachedForOnIterable' }],
        },
        {
          name: 'parameter typed Set<string>',
          code:
            'function walk(items: Set<string>): void {\n' +
            '  for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '    void i\n' +
            '  }\n' +
            '}\n',
          errors: [{ messageId: 'noCachedForOnIterable' }],
        },
        {
          name: 'arrow parameter typed Map<K, V>',
          code:
            'const walk = (m: Map<string, number>): void => {\n' +
            '  for (let i = 0, { length } = m; i < length; i += 1) {\n' +
            '    void i\n' +
            '  }\n' +
            '}\n',
          errors: [{ messageId: 'noCachedForOnIterable' }],
        },
        {
          name: 'set.length read returns undefined',
          // `Set.size` is the right name; reading `.length` quietly
          // returns undefined and is almost always a typo.
          code:
            'const items = new Set<string>()\n' +
            'const n = items.length\n' +
            'void n\n',
          errors: [{ messageId: 'lengthOnIterable' }],
        },
        {
          name: 'map.length read returns undefined',
          code:
            'declare const m: Map<string, number>\n' +
            'const n = m.length\n' +
            'void n\n',
          errors: [{ messageId: 'lengthOnIterable' }],
        },
        {
          name: 'set[i] indexed read (numeric literal)',
          code:
            'const items = new Set<string>()\n' +
            'const first = items[0]\n' +
            'void first\n',
          errors: [{ messageId: 'indexedAccessOnIterable' }],
        },
        {
          name: 'set[index] indexed read (counter identifier)',
          code:
            'declare const items: Set<string>\n' +
            'declare const index: number\n' +
            'const v = items[index]\n' +
            'void v\n',
          errors: [{ messageId: 'indexedAccessOnIterable' }],
        },
        {
          name: 'cached-for on iterable PLUS indexed read in body — both fire',
          code:
            'const items = new Set<string>()\n' +
            'for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '  const v = items[i]\n' +
            '  void v\n' +
            '}\n',
          errors: [
            { messageId: 'noCachedForOnIterable' },
            { messageId: 'indexedAccessOnIterable' },
          ],
        },
      ],
    })
  })
})
