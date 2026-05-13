/**
 * @fileoverview Unit tests for socket/prefer-undefined-over-null.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-undefined-over-null.mts'

describe('socket/prefer-undefined-over-null', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-undefined-over-null', rule, {
      valid: [
        { name: 'undefined literal', code: 'export const x = undefined\n' },
        {
          name: '__proto__: null (allowed)',
          code: 'const obj = { __proto__: null, a: 1 }\nconsole.log(obj.a)\n',
        },
        {
          name: 'Object.create(null) (allowed)',
          code: 'const obj = Object.create(null)\nconsole.log(obj)\n',
        },
        {
          name: 'JSON.stringify replacer slot (allowed)',
          code: 'JSON.stringify({ a: 1 }, null, 2)\n',
        },
        {
          name: '=== null comparison (allowed)',
          code: 'if (x === null) {}\n',
        },
      ],
      invalid: [
        {
          name: 'bare null assignment',
          code: 'export const x = null\n',
          errors: [{ messageId: 'preferUndefined' }],
        },
      ],
    })
  })
})
