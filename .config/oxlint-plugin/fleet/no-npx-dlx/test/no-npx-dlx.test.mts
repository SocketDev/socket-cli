/**
 * @file Unit tests for socket/no-npx-dlx.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/no-npx-dlx', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-npx-dlx', rule, {
      valid: [
        // `pnpm exec` is not a dlx/npx FETCH command, so THIS rule allows it.
        // (It's banned separately by no-pm-exec-guard for wrapper overhead.)
        { name: 'pnpm exec', code: 'const cmd = "pnpm exec oxlint"\n' },
        { name: 'pnpm run', code: 'const cmd = "pnpm run lint"\n' },
        {
          name: 'commented opt-out',
          code: 'const cmd = "npx foo" // socket-lint: allow npx\n',
        },
      ],
      invalid: [
        {
          name: 'bare npx',
          code: 'const cmd = "npx oxlint"\n',
          output: 'const cmd = "node_modules/.bin/oxlint"\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'pnpm dlx',
          code: 'const cmd = "pnpm dlx oxlint"\n',
          output: 'const cmd = "node_modules/.bin/oxlint"\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'yarn dlx',
          code: 'const cmd = "yarn dlx oxlint"\n',
          output: 'const cmd = "node_modules/.bin/oxlint"\n',
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
