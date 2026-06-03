/**
 * @file Unit tests for the no-vitest-focused-tests oxlint rule. Spawns the real
 *   oxlint binary against fixture files in a tmp dir (lib/rule-tester.mts).
 *   Fires only in `*.test.*` files, on `.only` modifiers and `fit`/`fdescribe`
 *   aliases. Skips silently when `oxlint` isn't on PATH.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-vitest-focused-tests.mts'

const IMPORTS = "import { describe, it, test } from 'vitest'\n"

describe('socket/no-vitest-focused-tests', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-vitest-focused-tests', rule, {
      valid: [
        {
          name: 'plain it() is fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('works', () => { expect(1).toBe(1) })\n`,
        },
        {
          name: 'plain describe() is fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}describe('group', () => {})\n`,
        },
        {
          name: '.only in a NON-test file is not flagged',
          filename: 'src/a.ts',
          code: `${IMPORTS}it.only('x', () => {})\n`,
        },
        {
          name: 'an unrelated .only member call (not it/test/describe) is ignored',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}collection.only('x')\n`,
        },
      ],
      invalid: [
        {
          name: 'it.only is flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it.only('x', () => {})\n`,
          errors: [{ messageId: 'focused' }],
        },
        {
          name: 'describe.only is flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}describe.only('g', () => {})\n`,
          errors: [{ messageId: 'focused' }],
        },
        {
          name: 'test.only is flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}test.only('x', () => {})\n`,
          errors: [{ messageId: 'focused' }],
        },
      ],
    })
  })
})
