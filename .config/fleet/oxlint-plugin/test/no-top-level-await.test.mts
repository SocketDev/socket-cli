/**
 * @file Unit tests for the no-top-level-await oxlint rule. Spawns the real
 *   oxlint binary against fixture files in a tmp dir (see lib/rule-tester.mts).
 *   Skips silently when `oxlint` isn't on PATH so a fresh-laptop checkout
 *   doesn't false-fail before `pnpm install` materializes the bin link.
 *
 *   Why the rule exists: fleet bundles publish to CJS (rolldown CJS output)
 *   and CJS does not support module-scope `await`. A regression there either
 *   fails the bundle outright or silently emits an uninitialized export.
 *   The valid cases pin the supported escape hatches (await inside an async
 *   function, an async IIFE, the `socket-hook: allow top-level-await`
 *   comment) so a future refactor can't quietly drop them.
 */

import { describe, test } from 'node:test'

import rule from '../rules/no-top-level-await.mts'
import { RuleTester } from '../lib/rule-tester.mts'

describe('socket/no-top-level-await', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-top-level-await', rule, {
      valid: [
        {
          name: 'await inside async function',
          code: 'async function f() { await Promise.resolve() }\n',
        },
        {
          name: 'await inside async arrow',
          code: 'const f = async () => { await Promise.resolve() }\n',
        },
        {
          name: 'await inside async IIFE',
          code: ';(async () => { await Promise.resolve() })()\n',
        },
        {
          name: 'bypass comment opts module out',
          code: '// socket-hook: allow top-level-await\nawait Promise.resolve()\n',
        },
      ],
      invalid: [
        {
          name: 'top-level await expression',
          code: 'await Promise.resolve()\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'top-level for await',
          code: 'for await (const x of [1, 2]) {}\n',
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
