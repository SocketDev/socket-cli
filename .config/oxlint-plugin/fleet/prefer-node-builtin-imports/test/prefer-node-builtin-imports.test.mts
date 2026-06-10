/**
 * @file Unit tests for socket/prefer-node-builtin-imports.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/prefer-node-builtin-imports', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-node-builtin-imports', rule, {
      valid: [
        {
          name: 'node: prefix',
          code: 'import path from "node:path"\nconsole.log(path)\n',
        },
        {
          name: 'node:fs',
          code: 'import { readFileSync } from "node:fs"\nreadFileSync("/x")\n',
        },
      ],
      invalid: [
        {
          name: 'node:path named-import — should prefer default',
          // The rule operates on `node:`-prefixed specifiers. For
          // small modules like `node:path`, prefer the default
          // import so call sites read `path.join(…)`.
          code: 'import { join } from "node:path"\nconsole.log(join("a", "b"))\n',
          errors: [{ messageId: 'preferDefault' }],
        },
        {
          name: 'node:fs default-import — should prefer cherry-pick named',
          code: 'import fs from "node:fs"\nfs.readFileSync("/x")\n',
          errors: [{ messageId: 'fsDefault' }],
        },
      ],
    })
  })
})
