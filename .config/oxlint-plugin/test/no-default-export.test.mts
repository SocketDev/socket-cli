/**
 * @fileoverview Unit tests for the no-default-export oxlint rule.
 *
 * Spawns the real oxlint binary against fixture files in a tmp dir
 * (see lib/rule-tester.mts). Skips silently when `oxlint` isn't on
 * PATH so a fresh-laptop checkout doesn't false-fail before
 * `pnpm install` materializes the bin link.
 */

import { describe, test } from 'node:test'

import rule from '../rules/no-default-export.mts'
import { RuleTester } from '../lib/rule-tester.mts'

describe('socket/no-default-export', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-default-export', rule, {
      valid: [
        { name: 'named const export', code: 'export const foo = 1\n' },
        { name: 'named function export', code: 'export function foo() {}\n' },
        { name: 'named class export', code: 'export class Foo {}\n' },
        {
          name: 'named re-export',
          code: 'export { foo } from "./mod"\n',
        },
      ],
      invalid: [
        {
          name: 'default function (named)',
          code: 'export default function foo() {}\n',
          errors: [{ messageId: 'noDefaultExport' }],
          output: 'export function foo() {}\n',
        },
        {
          name: 'default class (named)',
          code: 'export default class Foo {}\n',
          errors: [{ messageId: 'noDefaultExport' }],
          output: 'export class Foo {}\n',
        },
        {
          name: 'default identifier',
          code: 'const foo = 1\nexport default foo\n',
          errors: [{ messageId: 'noDefaultExport' }],
          output: 'const foo = 1\nexport { foo }\n',
        },
      ],
    })
  })
})
