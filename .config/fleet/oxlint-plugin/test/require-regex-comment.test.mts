/**
 * @file Unit tests for socket/require-regex-comment.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/require-regex-comment.mts'

describe('socket/require-regex-comment', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('require-regex-comment', rule, {
      valid: [
        {
          name: 'trivial single char class needs no comment',
          code: 'export const r = /\\d/\n',
        },
        {
          name: 'anchor-only pattern is trivial',
          code: 'export const r = /^$/\n',
        },
        {
          name: 'short all-literal pattern is trivial',
          code: 'export const r = /abc/\n',
        },
        {
          name: 'non-trivial regex with a leading comment is fine',
          code: '// matches a model property key (boundary, name, : or , or })\nexport const r = /(?:[\\s,{]|^)model\\s*[:,}]/\n',
        },
        {
          name: 'non-trivial regex with a trailing comment is fine',
          code: 'export const r = /(?:[\\s,{]|^)model\\s*[:,}]/ // model key\n',
        },
        {
          name: 'escape marker on the line suppresses the report',
          code: 'export const r = /(foo|bar|baz)+/ // socket-lint: allow uncommented-regex\n',
        },
      ],
      invalid: [
        {
          name: 'non-trivial regex with no comment is flagged',
          code: 'export const r = /(?:[\\s,{]|^)model\\s*[:,}]/\n',
          errors: [{ messageId: 'uncommented' }],
        },
        {
          name: 'alternation group with no comment is flagged',
          code: 'export const r = /(alpha|beta|gamma)+/\n',
          errors: [{ messageId: 'uncommented' }],
        },
        {
          name: 'a different-category escape marker does NOT suppress',
          code: 'export const r = /(foo|bar)+/ // socket-lint: allow regex-alternation-order\n',
          errors: [{ messageId: 'uncommented' }],
        },
      ],
    })
  })
})
