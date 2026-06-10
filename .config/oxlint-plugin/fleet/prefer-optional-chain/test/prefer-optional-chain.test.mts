/**
 * @file Unit tests for socket/prefer-optional-chain.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/prefer-optional-chain', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-optional-chain', rule, {
      valid: [
        {
          name: 'already optional',
          code: 'const r = a?.b\n',
        },
        {
          name: 'guard differs from access base (not provably equivalent)',
          code: 'const r = a.b && a.c.d\n',
        },
        {
          name: 'a || chain is not an optional-chain transform',
          code: 'const r = a || a.b\n',
        },
        {
          name: 'left operand is not the base of the right chain',
          code: 'const r = ok && other.run()\n',
        },
        {
          name: 'plain boolean conjunction with no member access',
          code: 'const r = a && b\n',
        },
      ],
      invalid: [
        {
          name: 'a && a.b → a?.b',
          code: 'const r = a && a.b\n',
          output: 'const r = a?.b\n',
          errors: [{ messageId: 'preferOptionalChain' }],
        },
        {
          name: 'a && a.b() → a?.b()',
          code: 'const r = a && a.b()\n',
          output: 'const r = a?.b()\n',
          errors: [{ messageId: 'preferOptionalChain' }],
        },
        {
          name: 'computed: a && a[k] → a?.[k]',
          code: 'const r = a && a[k]\n',
          output: 'const r = a?.[k]\n',
          errors: [{ messageId: 'preferOptionalChain' }],
        },
        {
          name: 'member guard: obj.x && obj.x.y → obj.x?.y',
          code: 'const r = obj.x && obj.x.y\n',
          output: 'const r = obj.x?.y\n',
          errors: [{ messageId: 'preferOptionalChain' }],
        },
        {
          name: 'the entrypoint-guard case',
          code: "const r = process.argv[1] && process.argv[1].endsWith('x')\n",
          output: "const r = process.argv[1]?.endsWith('x')\n",
          errors: [{ messageId: 'preferOptionalChain' }],
        },
      ],
    })
  })
})
