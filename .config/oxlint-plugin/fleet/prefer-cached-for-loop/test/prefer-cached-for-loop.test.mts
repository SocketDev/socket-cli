/**
 * @file Unit tests for socket/prefer-cached-for-loop.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/prefer-cached-for-loop', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-cached-for-loop', rule, {
      valid: [
        {
          name: 'cached for-loop',
          code: 'const xs = [1,2,3]\nfor (let i = 0, { length } = xs; i < length; i += 1) {}\n',
        },
        {
          name: 'for-of',
          code: 'for (const x of [1,2,3]) {}\n',
        },
        {
          name: 'for-of over awaited value — unknown kind, skip autofix',
          code:
            'async function f() {\n' +
            '  const items = await getThings()\n' +
            '  for (const x of items) { console.log(x) }\n' +
            '}\n',
        },
      ],
      invalid: [
        {
          name: 'forEach call',
          code: '[1,2,3].forEach((x) => {})\n',
          errors: [{ messageId: 'preferCachedForNoFix' }],
        },
        {
          name: 'forEach autofix terminates the inserted decl with a semicolon (ASI hazard: body starts with `[`)',
          code: 'const xs = [[1]]\nxs.forEach((item) => {\n  ;[a] = item\n})\n',
          errors: [{ messageId: 'preferCachedFor' }],
          output:
            'const xs = [[1]]\nfor (let i = 0, { length } = xs; i < length; i += 1) {\n  const item = xs[i]!;\n  ;[a] = item\n\n}\n',
        },
      ],
    })
  })
})
