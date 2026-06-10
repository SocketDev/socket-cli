/**
 * @file Unit tests for socket/no-boolean-trap-param.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/no-boolean-trap-param', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-boolean-trap-param', rule, {
      valid: [
        {
          name: 'single boolean param alone — a predicate',
          code: 'function isValid(v: boolean): boolean { return v }\n',
        },
        {
          name: 'options object instead of boolean positional',
          code: 'function f(x: string, opts: { verbose: boolean }) { return x }\n',
        },
        {
          name: 'no boolean params',
          code: 'function f(x: string, n: number) { return x }\n',
        },
        {
          name: 'overload signature (no body) is type-only',
          code: 'function f(x: string, flag: boolean): void\n',
        },
        {
          name: 'commented opt-out',
          code: '// socket-lint: allow boolean-trap\nfunction f(x: string, flag: boolean) { return x }\n',
        },
      ],
      invalid: [
        {
          name: 'function declaration with a boolean positional',
          code: 'function f(x: string, flag: boolean) { return x }\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'boolean | undefined positional',
          code: 'function f(a: number, dry: boolean | undefined) { return a }\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'optional boolean positional',
          code: 'function f(x: string, verbose?: boolean) { return x }\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'arrow function with a boolean positional',
          code: 'const f = (x: string, flag: boolean) => x\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'two boolean positionals → two reports',
          code: 'function f(a: number, b: boolean, c: boolean) { return a }\n',
          errors: [{ messageId: 'banned' }, { messageId: 'banned' }],
        },
      ],
    })
  })
})
