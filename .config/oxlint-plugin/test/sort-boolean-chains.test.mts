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
      ],
      invalid: [
        {
          name: 'unsorted && chain',
          code: 'export const r = (a: boolean, b: boolean, c: boolean) => c && a && b\n',
          errors: [{ messageId: 'unsorted' }],
        },
        {
          name: 'unsorted || chain',
          code: 'export const r = (a: boolean, b: boolean, c: boolean) => c || a || b\n',
          errors: [{ messageId: 'unsorted' }],
        },
      ],
    })
  })
})
