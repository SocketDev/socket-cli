/**
 * @file Unit tests for socket/sort-object-literal-properties.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/sort-object-literal-properties.mts'

describe('socket/sort-object-literal-properties', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('sort-object-literal-properties', rule, {
      valid: [
        {
          name: 'already sorted module-scope const',
          code: 'const o = { alpha: 1, beta: 2, gamma: 3 }\n',
        },
        {
          name: 'already sorted export const',
          code: 'export const o = { alpha: 1, beta: 2 }\n',
        },
        {
          name: 'single property',
          code: 'const o = { only: 1 }\n',
        },
        {
          name: '__proto__: null leads, rest sorted',
          code: 'const o = { __proto__: null, alpha: 1, beta: 2 }\n',
        },
        {
          name: 'spread present — left untouched even if unsorted',
          code: 'const o = { beta: 1, ...rest, alpha: 2 }\n',
        },
        {
          name: 'computed key present — left untouched',
          code: 'const o = { [k]: 1, alpha: 2 }\n',
        },
        {
          name: 'not in scope — nested literal in a call argument',
          code: 'fn({ beta: 1, alpha: 2 })\n',
        },
        {
          name: 'not in scope — object inside a function body',
          code: 'function f() { return { beta: 1, alpha: 2 } }\n',
        },
        {
          name: 'bypass marker on the line',
          code: 'const o = { beta: 1, alpha: 2 } // socket-hook: allow object-property-order\n',
        },
      ],
      invalid: [
        {
          name: 'unsorted module-scope const (single line)',
          code: 'const o = { gamma: 1, alpha: 2, beta: 3 }\n',
          output: 'const o = { alpha: 2, beta: 3, gamma: 1 }\n',
          errors: [{ messageId: 'unsorted' }],
        },
        {
          name: 'unsorted export const',
          code: 'export const o = { beta: 1, alpha: 2 }\n',
          output: 'export const o = { alpha: 2, beta: 1 }\n',
          errors: [{ messageId: 'unsorted' }],
        },
        {
          name: 'export default',
          code: 'export default { beta: 1, alpha: 2 }\n',
          output: 'export default { alpha: 2, beta: 1 }\n',
          errors: [{ messageId: 'unsorted' }],
        },
        {
          name: '__proto__ stays first when other keys reorder',
          code: 'const o = { __proto__: null, gamma: 1, alpha: 2 }\n',
          output: 'const o = { __proto__: null, alpha: 2, gamma: 1 }\n',
          errors: [{ messageId: 'unsorted' }],
        },
        {
          // Report-only: no `output` means the RuleTester asserts the rule
          // reports but applies no autofix (interior comment blocks reorder).
          name: 'interior comment — report only, no fix',
          code: 'const o = {\n  gamma: 1,\n  // note\n  alpha: 2,\n}\n',
          errors: [{ messageId: 'unsorted' }],
        },
      ],
    })
  })
})
