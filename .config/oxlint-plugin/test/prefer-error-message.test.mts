/**
 * @file Unit tests for socket/prefer-error-message.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-error-message.mts'

describe('socket/prefer-error-message', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-error-message', rule, {
      valid: [
        {
          name: 'errorMessage helper already in use',
          code: 'const msg = errorMessage(e)\n',
        },
        {
          name: 'plain String(e) without instanceof guard',
          code: 'const msg = String(e)\n',
        },
        {
          name: 'instanceof Error without the message/String shape',
          code: 'if (e instanceof Error) { throw e }\n',
        },
        {
          name: 'mismatched identifiers across positions',
          code: 'const msg = e instanceof Error ? other.message : String(e)\n',
        },
        {
          name: 'instanceof non-Error subclass',
          code: 'const msg = e instanceof TypeError ? e.message : String(e)\n',
        },
        {
          name: 'optional-chain variant (different semantics)',
          code: 'const msg = e?.message ?? String(e)\n',
        },
      ],
      invalid: [
        {
          name: 'canonical ternary with `e`',
          code: 'const msg = e instanceof Error ? e.message : String(e)\n',
          errors: [{ messageId: 'preferErrorMessage' }],
        },
        {
          name: 'canonical ternary with `err`',
          code: 'const msg = err instanceof Error ? err.message : String(err)\n',
          errors: [{ messageId: 'preferErrorMessage' }],
        },
        {
          name: 'inside a catch block',
          code: 'try { f() } catch (e) { log(e instanceof Error ? e.message : String(e)) }\n',
          errors: [{ messageId: 'preferErrorMessage' }],
        },
      ],
    })
  })
})
