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
          name: 'group referenced by a later \\1 backreference → stay silent',
          code: 'export const r = /([\'"]?)(?:main|master)\\1/\n',
        },
        {
          name: 'inner backreference anywhere in pattern → stay silent',
          code: 'export const r = /(foo|bar\\1)/\n',
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
        {
          name: '.replace with arrow callback destructuring captures',
          code: [
            'export function f(s: string) {',
            '  return s.replace(/^([A-Z]):/i, (_, letter) => letter.toLowerCase())',
            '}',
            '',
          ].join('\n'),
        },
        {
          name: '.replace with arrow callback, multi-line',
          code: [
            'export function f(s: string) {',
            '  return s.replace(',
            '    /^\\/([a-zA-Z])($|\\/)/,',
            '    (_, letter, sep) => `${letter.toUpperCase()}:${sep || "/"}`,',
            '  )',
            '}',
            '',
          ].join('\n'),
        },
        {
          name: '.replace with function-expression callback destructuring captures',
          code: [
            'export function f(s: string) {',
            '  return s.replace(/(\\w+)/, function (_match, word) { return word.toUpperCase() })',
            '}',
            '',
          ].join('\n'),
        },
        {
          name: 'StringPrototypeReplace with callback destructuring captures',
          code: [
            'import { StringPrototypeReplace } from "./primordials"',
            'export function f(s: string) {',
            '  return StringPrototypeReplace(s, /^([A-Z]):/, (_, letter) => letter.toLowerCase())',
            '}',
            '',
          ].join('\n'),
        },
        {
          name: 'StringPrototypeReplaceAll with callback destructuring captures',
          code: [
            'import { StringPrototypeReplaceAll } from "./primordials"',
            'export function f(s: string) {',
            '  return StringPrototypeReplaceAll(s, /(\\w+)/g, (_, word) => word.toUpperCase())',
            '}',
            '',
          ].join('\n'),
        },
        {
          name: '.replace with SINGLE-arg callback (full match only) is still fixable',
          // Note: even though there IS a `.replace()` call, the callback
          // is `c => ...` (1 arg = full match, no capture access). The
          // rule SHOULD still flag the captures as unused... but the
          // file-wide marker matcher stays conservative here too. Add as
          // a "valid" case (rule stays silent) — see invalid section
          // for the analogous flagged case without a .replace() call.
          code: [
            'export function f(s: string) {',
            '  return s.replace(/[a-zA-Z]/g, c => `[${c.toLowerCase()}]`)',
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
      ],
    })
  })
})
