/**
 * @fileoverview Unit tests for socket/no-status-emoji.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-status-emoji.mts'

describe('socket/no-status-emoji', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-status-emoji', rule, {
      valid: [
        { name: 'ascii markers', code: 'console.log("[ok] done")\n' },
        { name: 'no emoji', code: 'const x = "hello"\n' },
      ],
      invalid: [
        {
          name: 'check emoji',
          code: 'console.log("✓ done")\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'cross emoji',
          code: 'console.log("✗ failed")\n',
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
