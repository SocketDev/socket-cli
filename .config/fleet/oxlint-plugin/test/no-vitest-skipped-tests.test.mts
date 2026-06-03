/**
 * @file Unit tests for the no-vitest-skipped-tests oxlint rule. Flags
 *   UNCONDITIONAL `.skip` / `xit` / `xdescribe`; allows conditional skips
 *   (`.skipIf` / `.runIf` / `{ skip: <expr> }`). Spawns real oxlint; skips when
 *   absent.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-vitest-skipped-tests.mts'

const IMPORTS = "import { describe, it } from 'vitest'\n"

describe('socket/no-vitest-skipped-tests', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-vitest-skipped-tests', rule, {
      valid: [
        {
          name: 'plain it() is fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('x', () => {})\n`,
        },
        {
          name: 'conditional .skipIf is allowed',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it.skipIf(process.env.CI)('x', () => {})\n`,
        },
        {
          name: 'conditional .runIf is allowed',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it.runIf(cond)('x', () => {})\n`,
        },
        {
          name: 'options-object { skip: expr } is allowed',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}describe('g', { skip: !pkgs.length }, () => {})\n`,
        },
        {
          name: 'skip in a NON-test file is not flagged',
          filename: 'src/a.ts',
          code: `${IMPORTS}it.skip('x', () => {})\n`,
        },
      ],
      invalid: [
        {
          name: 'unconditional it.skip is flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it.skip('x', () => {})\n`,
          errors: [{ messageId: 'skipped' }],
        },
        {
          name: 'describe.skip is flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}describe.skip('g', () => {})\n`,
          errors: [{ messageId: 'skipped' }],
        },
      ],
    })
  })
})
