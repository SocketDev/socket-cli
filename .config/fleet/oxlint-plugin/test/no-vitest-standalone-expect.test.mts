/**
 * @file Unit tests for the no-vitest-standalone-expect oxlint rule. Flags
 *   `expect(...)` outside an it()/test() block (hooks allowed). Spawns real
 *   oxlint; skips when absent.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-vitest-standalone-expect.mts'

const IMPORTS = "import { beforeEach, describe, expect, it } from 'vitest'\n"

describe('socket/no-vitest-standalone-expect', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-vitest-standalone-expect', rule, {
      valid: [
        {
          name: 'expect inside it() is fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}it('x', () => { expect(1).toBe(1) })\n`,
        },
        {
          name: 'expect inside a hook is fine',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}beforeEach(() => { expect(setup()).toBeDefined() })\n`,
        },
        {
          name: 'standalone expect in a NON-test file is not flagged',
          filename: 'src/a.ts',
          code: `${IMPORTS}expect(1).toBe(1)\n`,
        },
      ],
      invalid: [
        {
          name: 'expect at module top level is flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}expect(1).toBe(1)\n`,
          errors: [{ messageId: 'standalone' }],
        },
        {
          name: 'expect directly in describe body is flagged',
          filename: 'test/unit/a.test.mts',
          code: `${IMPORTS}describe('g', () => { expect(1).toBe(1) })\n`,
          errors: [{ messageId: 'standalone' }],
        },
      ],
    })
  })
})
