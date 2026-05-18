/**
 * @fileoverview Unit tests for socket/no-promise-race.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-promise-race.mts'

describe('socket/no-promise-race', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-promise-race', rule, {
      valid: [
        {
          name: 'Promise.all',
          code: 'await Promise.all([fetch("a"), fetch("b")])\n',
        },
        {
          name: 'Promise.allSettled',
          code: 'await Promise.allSettled([fetch("a")])\n',
        },
        { name: 'Promise.any', code: 'await Promise.any([fetch("a")])\n' },
      ],
      invalid: [
        {
          name: 'Promise.race',
          code: 'await Promise.race([fetch("a"), fetch("b")])\n',
          errors: [{ messageId: 'noPromiseRace' }],
        },
      ],
    })
  })
})
