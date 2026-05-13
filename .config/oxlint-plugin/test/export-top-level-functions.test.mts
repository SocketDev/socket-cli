/**
 * @fileoverview Unit tests for socket/export-top-level-functions.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/export-top-level-functions.mts'

describe('socket/export-top-level-functions', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('export-top-level-functions', rule, {
      valid: [
        {
          name: 'exported function',
          code: 'export function foo() {}\n',
        },
        {
          name: 'declared then exported',
          code: 'function foo() {}\nexport { foo }\n',
        },
      ],
      invalid: [
        {
          name: 'unexported top-level function',
          code: 'function foo() {}\nfunction bar() {}\nbar()\n',
          errors: [{ messageId: 'missing' }],
        },
      ],
    })
  })
})
