/**
 * @file Unit tests for socket/export-top-level-functions.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/export-top-level-functions', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('export-top-level-functions', rule, {
      valid: [
        {
          name: 'inline export',
          code: 'export function foo() {}\n',
        },
        {
          // Skip the autofix entirely on CJS files — rewriting
          // `function foo() {}` to `export function foo() {}` in a
          // CJS module makes the file syntactically ESM and breaks
          // `require()` at load time. The .cjs extension is the
          // authoritative signal.
          name: 'cjs file is skipped (filename hint)',
          filename: 'fixture.cjs',
          code: 'function foo() {}\nmodule.exports = { foo }\n',
        },
        {
          // Same skip via content sniff when the extension is ambiguous
          // — wasm-bindgen `--target nodejs` output is the worked
          // example. `module.exports` + internal `function` is CJS.
          name: 'cjs file is skipped (content sniff on .js)',
          filename: 'fixture.js',
          code:
            'function getObject(idx) { return idx }\n' +
            'module.exports.getObject = getObject\n',
        },
        {
          name: 'inline export interface',
          filename: 'fixture.mts',
          code: 'export interface Foo { a: number }\n',
        },
        {
          name: 'inline export type alias',
          filename: 'fixture.mts',
          code: 'export type Foo = { a: number }\n',
        },
        {
          name: 'inline export class',
          filename: 'fixture.mts',
          code: 'export class Foo {}\n',
        },
      ],
      invalid: [
        {
          name: 'unexported top-level functions',
          // Both `foo` and `bar` are top-level and not exported —
          // each fires its own finding.
          code: 'function foo() {}\nfunction bar() {}\nbar()\n',
          errors: [{ messageId: 'missing' }, { messageId: 'missing' }],
        },
        {
          name: 'declared then re-exported via export-named',
          // The rule prefers inline `export function foo` and flags
          // the split form `function foo(); export { foo }` to avoid
          // the duplicate-name footgun (autofix is skipped to keep
          // the rewrite human-decided).
          code: 'function foo() {}\nexport { foo }\n',
          errors: [{ messageId: 'missingAlreadyReExported' }],
        },
        {
          name: 'unexported top-level interface',
          filename: 'fixture.mts',
          code: 'interface Foo { a: number }\n',
          errors: [{ messageId: 'missing' }],
        },
        {
          name: 'unexported top-level type alias',
          filename: 'fixture.mts',
          code: 'type Foo = { a: number }\n',
          errors: [{ messageId: 'missing' }],
        },
        {
          name: 'unexported top-level class',
          filename: 'fixture.mts',
          code: 'class Foo {}\n',
          errors: [{ messageId: 'missing' }],
        },
        {
          name: 'interface declared then re-exported via export-named',
          filename: 'fixture.mts',
          code: 'interface Foo { a: number }\nexport { Foo }\n',
          errors: [{ messageId: 'missingAlreadyReExported' }],
        },
      ],
    })
  })
})
