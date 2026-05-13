/**
 * @fileoverview Unit tests for socket/prefer-cached-for-loop.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-cached-for-loop.mts'

describe('socket/prefer-cached-for-loop', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-cached-for-loop', rule, {
      valid: [
        {
          name: 'cached for-loop',
          code: 'const xs = [1,2,3]\nfor (let i = 0, { length } = xs; i < length; i += 1) {}\n',
        },
        {
          name: 'for-of',
          code: 'for (const x of [1,2,3]) {}\n',
        },
      ],
      invalid: [
        {
          name: 'forEach call',
          code: '[1,2,3].forEach((x) => {})\n',
          errors: [{ messageId: 'preferCachedForNoFix' }],
        },
      ],
    })
  })
})
