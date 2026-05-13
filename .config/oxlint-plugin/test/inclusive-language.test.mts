/**
 * @fileoverview Unit tests for socket/inclusive-language.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/inclusive-language.mts'

describe('socket/inclusive-language', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('inclusive-language', rule, {
      valid: [
        { name: 'allowlist usage', code: 'const allowlist = ["a"]\nconsole.log(allowlist)\n' },
        { name: 'main branch', code: 'const branch = "main"\nconsole.log(branch)\n' },
      ],
      invalid: [
        {
          name: 'master/slave naming',
          code: 'const master = true\nconst slave = false\nconsole.log(master, slave)\n',
          errors: [{ messageId: 'legacyMaster' }, { messageId: 'legacySlave' }],
        },
      ],
    })
  })
})
