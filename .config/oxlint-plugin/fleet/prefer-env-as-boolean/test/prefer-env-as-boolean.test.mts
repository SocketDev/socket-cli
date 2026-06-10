/**
 * @file Unit tests for socket/prefer-env-as-boolean.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/prefer-env-as-boolean', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-env-as-boolean', rule, {
      valid: [
        {
          name: 'envAsBoolean wrap — correct shape',
          code: "import { envAsBoolean } from '@socketsecurity/lib-stable/env/boolean'\nconst x = envAsBoolean(getSocketDebug())\n",
        },
        {
          name: 'non-Socket getter — allowed',
          code: 'const x = !!getDebug()\n',
        },
        {
          name: 'truthy check on non-getter',
          code: 'const x = !!someValue\n',
        },
        {
          name: 'string comparison on non-Socket getter',
          code: "const x = getDebug() === 'true'\n",
        },
      ],
      invalid: [
        {
          name: '!!getSocketDebug()',
          code: 'const x = !!getSocketDebug()\n',
          errors: [{ messageId: 'coerce' }],
        },
        {
          name: 'Boolean(getSocketApiKey())',
          code: 'const x = Boolean(getSocketApiKey())\n',
          errors: [{ messageId: 'coerce' }],
        },
        {
          name: "getSocketDebug() === 'true'",
          code: "const x = getSocketDebug() === 'true'\n",
          errors: [{ messageId: 'coerce' }],
        },
        {
          name: "getSocketDebug() == '1'",
          code: "const x = getSocketDebug() == '1'\n",
          errors: [{ messageId: 'coerce' }],
        },
      ],
    })
  })
})
