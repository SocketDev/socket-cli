/**
 * @file Unit tests for the no-underscore-identifier oxlint rule. Spawns the
 *   real oxlint binary against fixture files in a tmp dir (see
 *   lib/rule-tester.mts). Skips silently when `oxlint` isn't on PATH so a
 *   fresh-laptop checkout doesn't false-fail before `pnpm install` materializes
 *   the bin link.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-underscore-identifier.mts'

describe('socket/no-underscore-identifier', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-underscore-identifier', rule, {
      valid: [
        {
          name: 'plain identifier',
          code: 'const foo = 1\n',
        },
        {
          name: 'PascalCase identifier',
          code: 'class Foo {}\n',
        },
        {
          name: 'identifier ending with underscore (suffix is allowed)',
          // The rule targets LEADING underscores; trailing ones are
          // a separate convention (TS pattern: `_unused`, conflict
          // with `delete_` keyword-clash, etc.) and out of scope.
          code: 'const foo_ = 1\n',
        },
      ],
      invalid: [
        {
          name: 'underscore-prefixed const',
          code: 'const _foo = 1\n',
          errors: [{ messageId: 'underscoreIdentifier' }],
        },
        {
          name: 'underscore-prefixed function',
          code: 'function _doFoo() {}\n',
          errors: [{ messageId: 'underscoreIdentifier' }],
        },
      ],
    })
  })
})
