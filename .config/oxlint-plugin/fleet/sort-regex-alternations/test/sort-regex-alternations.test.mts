/**
 * @file Unit tests for socket/sort-regex-alternations.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/sort-regex-alternations', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('sort-regex-alternations', rule, {
      valid: [
        {
          name: 'sorted alternation',
          code: 'export const r = /^(alpha|beta|gamma)$/\n',
        },
        {
          name: 'prefix-overlap left unsorted is NOT flagged (order-sensitive)',
          code: 'export const r = /(jsx|js)/\n',
        },
        {
          name: 'prefix-overlap already-alpha is also left alone',
          code: 'export const r = /(js|jsx)/\n',
        },
        {
          // `(^|\/)` mixes a `^` anchor with a literal slash — different kinds,
          // no meaningful order — so it is neither sorted nor flagged.
          name: 'anchor-vs-literal alternation is exempt (position-bearing)',
          code: 'export const r = /(^|\\/)pnpm-workspace\\.yaml$/\n',
        },
        {
          name: 'start-or-end anchor alternation is exempt',
          code: "export const r = /^['\"]|['\"]$/\n",
        },
      ],
      invalid: [
        {
          name: 'unsorted alternation',
          code: 'export const r = /^(gamma|alpha|beta)$/\n',
          errors: [{ messageId: 'unsorted' }],
          output: 'export const r = /^(alpha|beta|gamma)$/\n',
        },
      ],
    })
  })
})
