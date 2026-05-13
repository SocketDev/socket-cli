/**
 * @fileoverview Unit tests for socket/no-placeholders.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-placeholders.mts'

describe('socket/no-placeholders', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-placeholders', rule, {
      valid: [
        { name: 'real implementation', code: 'export function foo() { return 1 }\n' },
        { name: 'normal comment', code: '// explains the constraint\nexport const x = 1\n' },
      ],
      invalid: [
        {
          name: 'TODO comment',
          code: '// TODO: implement\nexport const x = 1\n',
          errors: [{ messageId: 'commentMarker' }],
        },
        {
          name: 'throw not-implemented',
          code: 'export function foo() { throw new Error("not implemented") }\n',
          errors: [{ messageId: 'throwPlaceholder' }],
        },
        {
          name: 'empty body stub',
          code: 'export function foo() {}\n',
          errors: [{ messageId: 'emptyBody' }],
        },
      ],
    })
  })
})
