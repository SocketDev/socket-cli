/**
 * @file Unit tests for socket/no-use-strict-in-esm.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/no-use-strict-in-esm', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-use-strict-in-esm', rule, {
      valid: [
        {
          name: 'mts with no directive',
          filename: 'fixture.mts',
          code: 'export const x = 1\n',
        },
        {
          name: 'mjs with no directive',
          filename: 'fixture.mjs',
          code: 'export const x = 1\n',
        },
        {
          // .cjs is legitimately a classic script — the directive is
          // meaningful there, so the rule must not touch it.
          name: 'cjs with use strict is allowed',
          filename: 'fixture.cjs',
          code: "'use strict'\nmodule.exports = {}\n",
        },
        {
          // Ambiguous .js may compile as a script; leave it alone.
          name: 'js with use strict is left alone',
          filename: 'fixture.js',
          code: "'use strict'\nconst x = 1\n",
        },
        {
          // A non-directive string expression is not 'use strict'.
          name: 'unrelated string expression statement',
          filename: 'fixture.mts',
          code: "'hello'\nexport const x = 1\n",
        },
      ],
      invalid: [
        {
          name: 'use strict in .mts',
          filename: 'fixture.mts',
          code: "'use strict'\nexport const x = 1\n",
          errors: [{ messageId: 'useStrictInEsm' }],
        },
        {
          name: 'use strict in .mjs',
          filename: 'fixture.mjs',
          code: "'use strict'\nexport const x = 1\n",
          errors: [{ messageId: 'useStrictInEsm' }],
        },
        {
          name: 'double-quoted use strict in .mts',
          filename: 'fixture.mts',
          code: '"use strict"\nexport const x = 1\n',
          errors: [{ messageId: 'useStrictInEsm' }],
        },
      ],
    })
  })
})
