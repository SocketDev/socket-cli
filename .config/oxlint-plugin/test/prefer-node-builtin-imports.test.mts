/**
 * @fileoverview Unit tests for socket/prefer-node-builtin-imports.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-node-builtin-imports.mts'

describe('socket/prefer-node-builtin-imports', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-node-builtin-imports', rule, {
      valid: [
        { name: 'node: prefix', code: 'import path from "node:path"\nconsole.log(path)\n' },
        { name: 'node:fs', code: 'import { readFileSync } from "node:fs"\nreadFileSync("/x")\n' },
      ],
      invalid: [
        {
          name: 'bare path import',
          code: 'import path from "path"\nconsole.log(path)\n',
          errors: [{ messageId: 'preferDefault' }],
        },
        {
          name: 'bare fs named',
          code: 'import { readFileSync } from "fs"\nreadFileSync("/x")\n',
          errors: [{ messageId: 'preferDefault' }],
        },
      ],
    })
  })
})
