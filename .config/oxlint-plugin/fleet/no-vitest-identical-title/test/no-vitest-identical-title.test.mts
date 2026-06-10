/**
 * @file Unit tests for the no-vitest-identical-title oxlint rule. Flags
 *   duplicate test/describe titles within the same describe scope; allows the
 *   same title in different scopes and `.each`-parametrized titles. Spawns real
 *   oxlint; skips when absent.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

const IMPORTS = "import { describe, it } from 'vitest'\n"

describe('socket/no-vitest-identical-title', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-vitest-identical-title', rule, {
      valid: [
        {
          name: 'distinct titles are fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('a', () => {})\nit('b', () => {})\n`,
        },
        {
          name: 'same title in different describe scopes is fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}describe('g1', () => { it('x', () => {}) })\ndescribe('g2', () => { it('x', () => {}) })\n`,
        },
        {
          name: '.each parametrized titles are not duplicates',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it.each([1,2])('case %s', () => {})\nit.each([3,4])('case %s', () => {})\n`,
        },
        {
          name: 'dynamic titles are not compared',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it(name, () => {})\nit(name, () => {})\n`,
        },
      ],
      invalid: [
        {
          name: 'duplicate it titles in same scope flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('x', () => {})\nit('x', () => {})\n`,
          errors: [{ messageId: 'duplicate' }],
        },
        {
          name: 'duplicate describe titles in same scope flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}describe('g', () => {})\ndescribe('g', () => {})\n`,
          errors: [{ messageId: 'duplicate' }],
        },
      ],
    })
  })
})
