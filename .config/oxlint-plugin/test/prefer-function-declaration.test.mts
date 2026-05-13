/**
 * @fileoverview Unit tests for socket/prefer-function-declaration.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-function-declaration.mts'

describe('socket/prefer-function-declaration', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-function-declaration', rule, {
      valid: [
        {
          name: 'function declaration',
          code: 'function foo() {}\n',
        },
        {
          name: 'arrow used as callback',
          code: '[1,2].map(x => x + 1)\n',
        },
      ],
      invalid: [
        {
          name: 'top-level const arrow',
          code: 'const foo = () => 1\n',
          errors: [{ messageId: 'preferFunctionDeclarationNoFix' }],
        },
      ],
    })
  })
})
