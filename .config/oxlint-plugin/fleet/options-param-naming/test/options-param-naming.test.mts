/**
 * @file Unit tests for socket/options-param-naming.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/options-param-naming', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('options-param-naming', rule, {
      valid: [
        {
          name: 'param already named options',
          code: 'function f(options?: { cwd?: string }) {\n  const opts = { __proto__: null, ...options }\n  return opts.cwd\n}\n',
        },
        {
          name: 'no options-bag param',
          code: 'function f(x: string) {\n  return x.length\n}\n',
        },
        {
          name: 'opts as a local (not a param) is fine',
          code: 'function f(options?: object) {\n  const opts = { __proto__: null, ...options }\n  return opts\n}\n',
        },
        {
          name: 'an unrelated property named opts is not a param',
          code: 'function f(o: { opts: number }) {\n  return o.opts\n}\n',
        },
        {
          name: 'commented opt-out',
          code: '// socket-lint: allow options-param-naming\nfunction f(opts?: { a: number }) {\n  return opts\n}\n',
        },
        {
          name: 'test file is skipped',
          code: 'function f(opts: { a: number }) {\n  return opts.a\n}\n',
          filename: 'foo.test.mts',
        },
        {
          name: 'file under a /test/ tree is skipped',
          code: 'function f(opts: { a: number }) {\n  return opts.a\n}\n',
          filename: 'test/unit/foo.mts',
        },
        {
          name: 'a .d.ts external-signature mirror is skipped',
          code: 'export function extract(spec: string, opts?: any): Promise<any>\n',
          filename: 'src/external/pacote.d.ts',
        },
      ],
      invalid: [
        {
          name: 'param named opts → rename param + reads to options',
          code: 'function f(opts?: { cwd?: string }) {\n  const { cwd } = opts\n  return cwd\n}\n',
          output:
            'function f(options?: { cwd?: string }) {\n  const { cwd } = options\n  return cwd\n}\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'param named opts read by member access',
          code: 'function f(opts: { a: number }) {\n  return opts.a\n}\n',
          output:
            'function f(options: { a: number }) {\n  return options.a\n}\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'the reassign-conflation anti-pattern is uniformly renamed',
          code: 'function f(opts?: { a?: number }) {\n  opts = { __proto__: null, ...opts }\n  return opts.a\n}\n',
          output:
            'function f(options?: { a?: number }) {\n  options = { __proto__: null, ...options }\n  return options.a\n}\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          // The options-null-proto autofix emits `… as typeof opts`; the `opts`
          // inside that `typeof` references the VALUE binding, so it must be
          // renamed too or it dangles (Cannot find name 'opts'). Regression
          // test for the two-autofix collision.
          name: 'as-typeof of the renamed param is co-renamed (no dangling opts)',
          code: 'function f(opts?: { a?: number }) {\n  opts = { __proto__: null, ...opts } as typeof opts\n  return opts.a\n}\n',
          output:
            'function f(options?: { a?: number }) {\n  options = { __proto__: null, ...options } as typeof options\n  return options.a\n}\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'an unrelated x.opts property name is NOT renamed',
          code: 'function f(opts: { a: number }, src: { opts: number }) {\n  return opts.a + src.opts\n}\n',
          output:
            'function f(options: { a: number }, src: { opts: number }) {\n  return options.a + src.opts\n}\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'clash with an existing options param → report, no fix',
          code: 'function f(options: { a: number }, opts: { b: number }) {\n  return options.a + opts.b\n}\n',
          errors: [{ messageId: 'bannedNoFix' }],
        },
      ],
    })
  })
})
