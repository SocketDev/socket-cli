/**
 * @file Unit tests for socket/no-inline-defer-async.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-inline-defer-async.mts'

describe('socket/no-inline-defer-async', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-inline-defer-async', rule, {
      valid: [
        {
          name: 'plain string — no script tag',
          code: 'const x = "hello world"\n',
        },
        {
          name: 'script with src and defer — valid external',
          code: 'const html = \'<script defer src="/main.js"></script>\'\n',
        },
        {
          name: 'script with src and async — valid external',
          code: 'const html = \'<script async src="/main.js"></script>\'\n',
        },
        {
          name: 'inline script without defer/async — fine',
          code: 'const html = "<script>doThing()</script>"\n',
        },
      ],
      invalid: [
        {
          name: 'inline <script defer> in string literal',
          code: 'const html = "<script defer>doThing()</script>"\n',
          errors: [{ messageId: 'inlineDeferAsync', data: { attr: 'defer' } }],
        },
        {
          name: 'inline <script async> in template literal',
          code: 'const html = `<script async>${body}</script>`\n',
          errors: [{ messageId: 'inlineDeferAsync', data: { attr: 'async' } }],
        },
      ],
    })
  })
})
