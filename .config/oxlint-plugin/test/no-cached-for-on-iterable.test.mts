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
      ],
      invalid: [
        {
          name: 'new Set() binding — bare init',
          code:
            'const items = new Set()\n' +
            'for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '  const item = items[i]!\n' +
            '  void item\n' +
            '}\n',
          errors: [{ messageId: 'noCachedForOnIterable' }],
        },
        {
          name: 'Set<string> annotation',
          code:
            'declare const items: Set<string>\n' +
            'for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '  void items[i]\n' +
            '}\n',
          errors: [{ messageId: 'noCachedForOnIterable' }],
        },
        {
          name: 'ReadonlySet<string> annotation',
          code:
            'declare const items: ReadonlySet<string>\n' +
            'for (let i = 0, { length } = items; i < length; i += 1) {\n' +
            '  void items[i]\n' +
            '}\n',
          errors: [{ messageId: 'noCachedForOnIterable' }],
        },
        {
          name: 'new Map() binding',
          code:
            'const m = new Map<string, number>()\n' +
            'for (let i = 0, { length } = m; i < length; i += 1) {\n' +
            '  void m[i]\n' +
            '}\n',
          errors: [{ messageId: 'noCachedForOnIterable' }],
        },
        {
          name: 'Map<K, V> annotation',
          code:
            'declare const m: Map<string, number>\n' +
            'for (let i = 0, { length } = m; i < length; i += 1) {\n' +
            '  void m[i]\n' +
            '}\n',
          errors: [{ messageId: 'noCachedForOnIterable' }],
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
      ],
    })
  })
})
