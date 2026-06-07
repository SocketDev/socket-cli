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
        {
          name: 'imported underscore name (upstream-owned, cannot rename)',
          code: 'import { _external } from "pkg"\n_external()\n',
        },
        {
          name: 'computed member assignment with underscore key is not a binding',
          code: 'const o = {}\no["_x"] = 1\n',
        },
        {
          name: 'underscore-prefixed function parameter (governed by tsc, not this rule)',
          // A leading `_` on a parameter is TypeScript's own marker for an
          // intentionally-unused param under `noUnusedParameters` (TS6133).
          // Banning it here would conflict with tsc — a positionally-required
          // but unused param (Proxy traps, fixed-arity callbacks) MUST keep the
          // `_`. So params are out of scope for this rule.
          code: 'function f(_x: number) { return 1 }\n',
        },
        {
          name: 'underscore-prefixed arrow parameter (governed by tsc)',
          code: 'const f = (_y: number) => 1\n',
        },
      ],
      invalid: [
        {
          name: 'underscore-prefixed const',
          code: 'const _foo = 1\n',
          errors: [{ messageId: 'noUnderscoreIdentifier' }],
        },
        {
          name: 'underscore-prefixed function',
          code: 'function _doFoo() {}\n',
          errors: [{ messageId: 'noUnderscoreIdentifier' }],
        },
        {
          name: 'underscore-prefixed method name',
          code: 'class K {\n  _doFoo() {}\n}\n',
          errors: [{ messageId: 'noUnderscoreIdentifier' }],
        },
        {
          name: 'underscore-prefixed class field',
          code: 'class K {\n  _field = 1\n}\n',
          errors: [{ messageId: 'noUnderscoreIdentifier' }],
        },
      ],
    })
  })
})
