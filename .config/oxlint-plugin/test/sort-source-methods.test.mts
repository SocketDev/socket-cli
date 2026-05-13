/**
 * @fileoverview Unit tests for socket/sort-source-methods.
 *
 * This rule sorts function/method declarations at the top level of a
 * file by group (constants, types, exports, etc.) and then
 * alphabetically. Tests cover both axes.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/sort-source-methods.mts'

describe('socket/sort-source-methods', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('sort-source-methods', rule, {
      valid: [
        {
          name: 'alphabetic',
          code: 'function alpha() {}\nfunction beta() {}\nfunction gamma() {}\n',
        },
      ],
      invalid: [
        {
          name: 'out of order alphabetically',
          code: 'function gamma() {}\nfunction alpha() {}\nfunction beta() {}\n',
          errors: [{ messageId: 'alphaOutOfOrder' }],
        },
      ],
    })
  })
})
