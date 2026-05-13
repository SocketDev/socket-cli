/**
 * @fileoverview Unit tests for socket/sort-named-imports.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/sort-named-imports.mts'

describe('socket/sort-named-imports', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('sort-named-imports', rule, {
      valid: [
        {
          name: 'sorted named imports',
          code: 'import { alpha, beta, gamma } from "./mod"\nconsole.log(alpha, beta, gamma)\n',
        },
      ],
      invalid: [
        {
          name: 'unsorted',
          code: 'import { gamma, alpha, beta } from "./mod"\nconsole.log(alpha, beta, gamma)\n',
          errors: [{ messageId: 'unsorted' }],
        },
      ],
    })
  })
})
