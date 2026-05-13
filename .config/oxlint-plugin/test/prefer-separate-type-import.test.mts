/**
 * @fileoverview Unit tests for socket/prefer-separate-type-import.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-separate-type-import.mts'

describe('socket/prefer-separate-type-import', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-separate-type-import', rule, {
      valid: [
        {
          name: 'separate type import',
          code: 'import { Foo } from "./mod"\nimport type { Bar } from "./mod"\nconst f: Bar = new Foo()\n',
        },
      ],
      invalid: [
        {
          name: 'inline `type` modifier mixed',
          code: 'import { Foo, type Bar } from "./mod"\nconst f: Bar = new Foo()\n',
          errors: [{ messageId: 'preferSeparateTypeImport' }],
        },
      ],
    })
  })
})
