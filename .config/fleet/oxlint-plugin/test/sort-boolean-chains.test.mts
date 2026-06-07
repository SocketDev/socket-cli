/**
 * @file Unit tests for socket/sort-boolean-chains.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/sort-boolean-chains.mts'

describe('socket/sort-boolean-chains', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('sort-boolean-chains', rule, {
      valid: [
        {
          name: 'sorted && chain',
          code: 'export const r = (a: boolean, b: boolean, c: boolean) => a && b && c\n',
        },
        {
          name: 'sorted || chain',
          code: 'export const r = (a: boolean, b: boolean, c: boolean) => a || b || c\n',
        },
        {
          name: 'mixed shape — call expression skipped',
          code: 'export const r = (a: boolean, f: () => boolean) => a && f()\n',
        },
        {
          name: 'mixed shape — member access skipped',
          code: 'export const r = (a: boolean, o: { b: boolean }) => o.b && a\n',
        },
        {
          name: 'single operand — not a chain',
          code: 'export const r = (a: boolean) => a\n',
        },
        {
          name: 'two-operand guard pair — narrative order preserved',
          code: 'export const r = (useHttp: boolean, oauthEnabled: boolean) => useHttp && oauthEnabled\n',
        },
        {
          name: 'two-operand reversed guard pair — still not sorted',
          code: 'export const r = (b: boolean, a: boolean) => b && a\n',
        },
        {
          name: 'duplicates skipped',
          code: 'export const r = (b: boolean, a: boolean) => b && a && b\n',
        },
        {
          name: 'VALUE context not reordered (&& returns a specific operand)',
          // `(c && a && b)` is `0` when c=0; `(a && b && c)` is `null`. The
          // result is assigned, not tested, so reordering would change it.
          code: 'declare const a: unknown, b: unknown, c: unknown\nconst x = c && a && b\n',
        },
        {
          name: 'VALUE context in a return is not reordered',
          code: 'declare const a: unknown, b: unknown, c: unknown\nfunction f() {\n  return c || a || b\n}\n',
        },
      ],
      invalid: [
        {
          name: 'unsorted && chain in an if test',
          code: 'declare const a: boolean, b: boolean, c: boolean\nif (c && a && b) {\n}\n',
          errors: [{ messageId: 'unsorted' }],
          output:
            'declare const a: boolean, b: boolean, c: boolean\nif (a && b && c) {\n}\n',
        },
        {
          name: 'unsorted || chain in a while test',
          code: 'declare const a: boolean, b: boolean, c: boolean\nwhile (c || a || b) {\n  break\n}\n',
          errors: [{ messageId: 'unsorted' }],
          output:
            'declare const a: boolean, b: boolean, c: boolean\nwhile (a || b || c) {\n  break\n}\n',
        },
        {
          name: 'unsorted chain under ! is still a boolean context',
          code: 'declare const a: boolean, b: boolean, c: boolean\nconst x = !(c && a && b)\n',
          errors: [{ messageId: 'unsorted' }],
          output:
            'declare const a: boolean, b: boolean, c: boolean\nconst x = !(a && b && c)\n',
        },
      ],
    })
  })
})
