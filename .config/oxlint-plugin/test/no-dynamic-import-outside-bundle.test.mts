/**
 * @fileoverview Unit tests for socket/no-dynamic-import-outside-bundle.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-dynamic-import-outside-bundle.mts'

describe('socket/no-dynamic-import-outside-bundle', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-dynamic-import-outside-bundle', rule, {
      valid: [
        {
          name: 'static import',
          code: 'import { x } from "./mod"\nconsole.log(x)\n',
        },
      ],
      invalid: [
        {
          name: 'top-level dynamic import',
          code: 'const m = await import("./mod")\nconsole.log(m)\n',
          errors: [{ messageId: 'dynamic' }],
        },
      ],
    })
  })
})
