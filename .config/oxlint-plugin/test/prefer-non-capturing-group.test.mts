/**
 * @file Unit tests for socket/prefer-non-capturing-group.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-non-capturing-group.mts'

describe('socket/prefer-non-capturing-group', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-non-capturing-group', rule, {
      valid: [
        {
          name: 'already non-capturing',
          code: 'export const r = /\\.(?:md|mdx)$/\n',
        },
        {
          name: 'capture used via match[1]',
          code: [
            'export function f(s: string) {',
            '  const m = /^(foo|bar)$/.exec(s)',
            '  return m?.[1]',
            '}',
            '',
          ].join('\n'),
        },
        {
          name: 'capture used via $1 in replacement',
          code: [
            'export function f(s: string) {',
            "  return s.replace(/(\\w+)/, '<$1>')",
            '}',
            '',
          ].join('\n'),
        },
        {
          name: 'line-level allow-capture marker',
          code: 'export const r = /(md|mdx)/ // socket-hook: allow capture\n',
        },
        {
          name: 'lookahead (?=...)',
          code: 'export const r = /foo(?=bar)/\n',
        },
        {
          name: 'named capture (?<name>...)',
          code: 'export const r = /(?<ext>md|mdx)/\n',
        },
        {
          name: 'usage markers anywhere in file → stay silent',
          code: [
            'export function f(s: string) {',
            '  const used = /^(yes)$/.exec(s)',
            '  const unused = /^(a|b)$/.test(s)',
            '  return [used?.[1], unused]',
            '}',
            '',
          ].join('\n'),
        },
      ],
      invalid: [
        {
          name: 'bare alternation in test-only regex',
          code: 'export const r = /\\.(md|mdx)$/\n',
          errors: [{ messageId: 'unused' }],
          output: 'export const r = /\\.(?:md|mdx)$/\n',
        },
        {
          name: 'bare alternation, multiple groups',
          code: 'export const r = /^(foo|bar)\\.(md|mdx)$/.test("x")\n',
          errors: [{ messageId: 'unused' }, { messageId: 'unused' }],
          output: 'export const r = /^(?:foo|bar)\\.(?:md|mdx)$/.test("x")\n',
        },
        {
          name: 'inner contains backreference → report only',
          code: 'export const r = /(foo|bar\\1)/\n',
          errors: [{ messageId: 'unusedNoFix' }],
        },
      ],
    })
  })
})
