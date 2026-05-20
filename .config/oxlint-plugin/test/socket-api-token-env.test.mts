/**
 * @file Unit tests for socket/socket-api-token-env.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/socket-api-token-env.mts'

describe('socket/socket-api-token-env', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('socket-api-token-env', rule, {
      valid: [
        {
          name: 'canonical SOCKET_API_TOKEN',
          code: 'const t = process.env["SOCKET_API_TOKEN"]\nconsole.log(t)\n',
        },
        {
          name: 'alias-lookup array with declaration-level bypass comment',
          code:
            "// socket-api-token-env: bootstrap -- alias-normalization shim.\n" +
            "const ALIASES = ['SOCKET_API_TOKEN', 'SOCKET_API_KEY', 'SOCKET_SECURITY_API_TOKEN'] as const\n" +
            "console.log(ALIASES)\n",
        },
      ],
      invalid: [
        {
          name: 'legacy SOCKET_API_KEY env',
          code: 'const t = process.env["SOCKET_API_KEY"]\nconsole.log(t)\n',
          errors: [{ messageId: 'legacy' }],
        },
        {
          name: 'legacy SOCKET_SECURITY_API_TOKEN env',
          code: 'const t = process.env["SOCKET_SECURITY_API_TOKEN"]\nconsole.log(t)\n',
          errors: [{ messageId: 'legacy' }],
        },
      ],
    })
  })
})
