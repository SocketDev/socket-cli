/**
 * @file Unit tests for the no-vitest-empty-test oxlint rule. Flags a test case
 *   with no assertion in its body; allows `.todo` / `.skip` and any body that
 *   reaches an `expect(...)` / `assert(...)`. Spawns real oxlint; skips when
 *   absent.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-vitest-empty-test.mts'

const IMPORTS = "import { it } from 'vitest'\n"

describe('socket/no-vitest-empty-test', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-vitest-empty-test', rule, {
      valid: [
        {
          name: 'test with an expect is fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('x', () => { expect(1).toBe(1) })\n`,
        },
        {
          name: 'test calling an expect<Upper> assertion helper is fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('x', () => { expectLiteralRoundtrip('a') })\n`,
        },
        {
          name: 'test with a nested expect (in a callback) is fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('x', () => { run(() => { expect(1).toBe(1) }) })\n`,
        },
        {
          name: 'it.todo with no body is fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it.todo('later')\n`,
        },
        {
          name: 'assertion via assert() counts',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('x', () => { assert(cond) })\n`,
        },
        {
          name: 'NON-test file not flagged',
          filename: 'src/a.ts',
          code: `${IMPORTS}it('x', () => { doThing() })\n`,
        },
      ],
      invalid: [
        {
          name: 'test with no assertion flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('x', () => { doThing() })\n`,
          errors: [{ messageId: 'noAssertion' }],
        },
        {
          name: 'vacuous placeholder body (no expect) flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('x', () => { const a = 1 })\n`,
          errors: [{ messageId: 'noAssertion' }],
        },
      ],
    })
  })
})
