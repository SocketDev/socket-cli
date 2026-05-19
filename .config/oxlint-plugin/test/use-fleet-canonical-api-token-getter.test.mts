/**
 * @file Unit tests for socket/use-fleet-canonical-api-token-getter.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/use-fleet-canonical-api-token-getter.mts'

describe('socket/use-fleet-canonical-api-token-getter', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('use-fleet-canonical-api-token-getter', rule, {
      valid: [
        {
          name: 'using the helper — correct',
          code: "import { readSocketApiToken } from '@socketsecurity/lib-stable/secrets/socket-api-token'\nconst t = await readSocketApiToken()\n",
        },
        {
          name: 'unrelated env read',
          code: 'const path = process.env.PATH\n',
        },
        {
          name: 'SOCKET_CLI_API_TOKEN — different setting, not flagged',
          code: 'const t = process.env.SOCKET_CLI_API_TOKEN\n',
        },
        {
          name: 'bypass comment — allowed',
          code: '// socket-api-token-getter: allow direct-env\nconst t = process.env.SOCKET_API_TOKEN\n',
        },
      ],
      invalid: [
        {
          name: 'process.env.SOCKET_API_TOKEN',
          code: 'const t = process.env.SOCKET_API_TOKEN\n',
          errors: [
            { messageId: 'directEnv', data: { name: 'SOCKET_API_TOKEN' } },
          ],
        },
        {
          name: "process.env['SOCKET_API_TOKEN']",
          code: "const t = process.env['SOCKET_API_TOKEN']\n",
          errors: [
            { messageId: 'directEnv', data: { name: 'SOCKET_API_TOKEN' } },
          ],
        },
        {
          name: 'process.env.SOCKET_API_KEY (legacy)',
          code: 'const t = process.env.SOCKET_API_KEY\n',
          errors: [
            { messageId: 'directEnv', data: { name: 'SOCKET_API_KEY' } },
          ],
        },
      ],
    })
  })
})
