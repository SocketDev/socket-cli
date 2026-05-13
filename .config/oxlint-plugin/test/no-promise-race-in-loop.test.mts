/**
 * @fileoverview Unit tests for socket/no-promise-race-in-loop.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-promise-race-in-loop.mts'

describe('socket/no-promise-race-in-loop', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-promise-race-in-loop', rule, {
      valid: [
        {
          name: 'race outside loop',
          code: 'await Promise.race([a, b])\n',
        },
        {
          name: 'Promise.all in loop',
          code: 'for (const item of items) { await Promise.all([fetch(item)]) }\n',
        },
      ],
      invalid: [
        {
          name: 'race in for-loop',
          code: 'for (const i of items) { await Promise.race([fetch(i), timeout()]) }\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'race in while-loop',
          code: 'while (cond) { await Promise.race([a, b]) }\n',
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
