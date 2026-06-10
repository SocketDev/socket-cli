/**
 * @file Unit tests for socket/prefer-pure-call-form.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/prefer-pure-call-form', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-pure-call-form', rule, {
      valid: [
        {
          name: 'magic adjacent to bare call',
          code: 'const x = /*@__PURE__*/ foo()\n',
        },
        {
          name: 'magic adjacent to NewExpression',
          code: 'const x = /*@__PURE__*/ new Logger()\n',
        },
        {
          name: 'magic adjacent to method call',
          code: 'const x = /*@__PURE__*/ obj.method()\n',
        },
        {
          name: 'magic adjacent to chained call',
          code: 'const x = /*@__PURE__*/ make().then()\n',
        },
        {
          name: 'no magic comments at all',
          code: 'const x = foo()\n',
        },
        {
          name: 'unrelated block comment',
          code: '/* explanation */\nconst x = foo()\n',
        },
        {
          name: 'magic with NO_SIDE_EFFECTS adjacent to call',
          code: 'const x = /*@__NO_SIDE_EFFECTS__*/ foo()\n',
        },
      ],
      invalid: [
        {
          name: 'magic on class declaration (oxfmt misplacement)',
          code: '/*@__PURE__*/ class Logger {}\n',
          errors: [{ messageId: 'detachedPureComment' }],
        },
        {
          name: 'magic on bare identifier reference',
          code: 'const ctor = /*@__PURE__*/ SomeClass\n',
          errors: [{ messageId: 'detachedPureComment' }],
        },
        {
          name: 'magic outside parens, call inside',
          code: 'const x = /*@__PURE__*/ (foo()).bar\n',
          errors: [{ messageId: 'detachedPureComment' }],
        },
      ],
    })
  })
})
