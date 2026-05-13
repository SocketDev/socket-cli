/**
 * @fileoverview Unit tests for socket/sort-equality-disjunctions.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/sort-equality-disjunctions.mts'

describe('socket/sort-equality-disjunctions', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('sort-equality-disjunctions', rule, {
      valid: [
        {
          name: 'sorted disjunction',
          code: 'export const r = (x: string) => x === "a" || x === "b" || x === "c"\n',
        },
      ],
      invalid: [
        {
          name: 'unsorted disjunction',
          code: 'export const r = (x: string) => x === "c" || x === "a" || x === "b"\n',
          errors: [{ messageId: 'unsorted' }],
        },
      ],
    })
  })
})
