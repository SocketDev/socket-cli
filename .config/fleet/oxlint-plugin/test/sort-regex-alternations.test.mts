/**
 * @file Unit tests for socket/sort-regex-alternations.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/sort-regex-alternations.mts'

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
