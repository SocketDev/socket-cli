/**
 * @fileoverview Unit tests for socket/no-npx-dlx.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-npx-dlx.mts'

describe('socket/no-npx-dlx', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-npx-dlx', rule, {
      valid: [
        { name: 'pnpm exec', code: 'const cmd = "pnpm exec oxlint"\n' },
        { name: 'pnpm run', code: 'const cmd = "pnpm run lint"\n' },
        {
          name: 'commented opt-out',
          code: 'const cmd = "npx foo" // socket-hook: allow npx\n',
        },
      ],
      invalid: [
        {
          name: 'bare npx',
          code: 'const cmd = "npx oxlint"\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'pnpm dlx',
          code: 'const cmd = "pnpm dlx oxlint"\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'yarn dlx',
          code: 'const cmd = "yarn dlx oxlint"\n',
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
