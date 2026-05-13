/**
 * @fileoverview Unit tests for socket/personal-path-placeholders.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/personal-path-placeholders.mts'

describe('socket/personal-path-placeholders', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('personal-path-placeholders', rule, {
      valid: [
        { name: 'placeholder path', code: 'const p = "/Users/<user>/projects/foo"\n' },
        { name: 'no path mention', code: 'export const x = 1\n' },
      ],
      invalid: [
        {
          name: 'literal /Users/jdalton path',
          code: 'const p = "/Users/jdalton/projects/foo"\n',
          errors: [{ messageId: 'realUsername' }],
        },
      ],
    })
  })
})
