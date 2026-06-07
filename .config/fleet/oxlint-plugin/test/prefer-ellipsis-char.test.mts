/**
 * @file Unit tests for socket/prefer-ellipsis-char.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-ellipsis-char.mts'

describe('socket/prefer-ellipsis-char', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-ellipsis-char', rule, {
      valid: [
        {
          name: 'spread operator is syntax, not text',
          code: 'const a = [...arr]\nconst b = { ...obj }\nexport { a, b }\n',
        },
        {
          name: 'rest parameter is syntax, not text',
          code: 'export function f(...args: number[]) {\n  return args\n}\n',
        },
        {
          name: 'already uses the ellipsis character',
          code: "const msg = 'Loading…'\n",
        },
        {
          name: 'two dots is not an ellipsis',
          code: "const rel = '../sibling'\n",
        },
        {
          name: 'path glob with trailing ... is not flagged',
          code: "const tip = 'use /Users/<user>/... for the home path'\n",
        },
        {
          name: 'path glob with leading ... is not flagged',
          code: "const g = 'matches .../node_modules/foo'\n",
        },
        {
          name: 'CLI rest-arg (dots after a space) is not flagged',
          code: "const usage = 'run foo ...args'\n",
        },
        {
          name: 'CLI placeholder bracket notation is not flagged',
          code: "const usage = 'clone [path...]'\n",
        },
        {
          name: 'CLI rest-arg in parens is not flagged',
          code: "const sig = 'fn(args...)'\n",
        },
        {
          name: 'bypass marker allows the literal form',
          code:
            '// socket-lint: allow literal-ellipsis\n' +
            "const usage = 'truncated word...'\n",
        },
      ],
      invalid: [
        {
          name: 'three dots in a string literal',
          code: "const msg = 'Loading...'\n",
          errors: [{ messageId: 'literalEllipsis' }],
          output: "const msg = 'Loading…'\n",
        },
        {
          name: 'three dots in a template literal',
          code: 'const msg = `Saving...`\n',
          errors: [{ messageId: 'literalEllipsis' }],
          output: 'const msg = `Saving…`\n',
        },
        {
          name: 'four dots collapse to a single ellipsis',
          code: "const msg = 'wait....'\n",
          errors: [{ messageId: 'literalEllipsis' }],
          output: "const msg = 'wait…'\n",
        },
      ],
    })
  })
})
