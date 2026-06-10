/**
 * @file Unit tests for socket/inclusive-language.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/inclusive-language', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('inclusive-language', rule, {
      valid: [
        {
          name: 'allowlist usage',
          code: 'const allowlist = ["a"]\nconsole.log(allowlist)\n',
        },
        {
          name: 'main branch',
          code: 'const branch = "main"\nconsole.log(branch)\n',
        },
        // Linkage positions: renaming would break the binding — never flag.
        {
          name: 're-export specifier (module exports `whitelist`)',
          code: 'export { whitelist } from "pkg"\n',
        },
        {
          name: 'member property access (external field)',
          code: 'const cfg = globalThis.cfg\nconsole.log(cfg.whitelist)\n',
        },
        {
          name: 'object-literal key (API shape)',
          code: 'const opts = { whitelist: 1 }\nconsole.log(opts)\n',
        },
      ],
      invalid: [
        {
          name: 'owned variable name still flags + fixes (whitelist → allowlist)',
          code: 'const whitelist = ["a"]\n',
          errors: [{ messageId: 'legacy' }],
          output: 'const allowlist = ["a"]\n',
        },
        {
          name: 'master/slave naming',
          code: 'const master = true\nconst slave = false\nconsole.log(master, slave)\n',
          // Each occurrence of `master` / `slave` is flagged
          // individually, including references in the
          // `console.log` call — 4 findings total.
          errors: [
            { messageId: 'legacyMaster' },
            { messageId: 'legacySlave' },
            { messageId: 'legacyMaster' },
            { messageId: 'legacySlave' },
          ],
        },
      ],
    })
  })
})
