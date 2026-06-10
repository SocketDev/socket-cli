/**
 * @file Unit tests for socket/no-bare-crypto-named-usage.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/no-bare-crypto-named-usage', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-bare-crypto-named-usage', rule, {
      valid: [
        {
          name: 'no node:crypto import — bare identifier passes',
          code: "const x = createHash('sha256')\n",
        },
        {
          name: 'named-import form — not this rule',
          code: "import { createHash } from 'node:crypto'\nconst h = createHash('sha256')\n",
        },
        {
          name: 'default import + member access',
          code: "import crypto from 'node:crypto'\nconst h = crypto.createHash('sha256')\n",
        },
        {
          name: 'exported local shadows the crypto name — bare call is the local',
          code:
            "import crypto from 'node:crypto'\n" +
            'export function randomBytes(n) { return n }\n' +
            'const b = randomBytes(16)\n',
        },
        {
          name: 'exported const local shadows the crypto name',
          code:
            "import crypto from 'node:crypto'\n" +
            'export const createHash = (a) => a\n' +
            "const h = createHash('x')\n",
        },
      ],
      invalid: [
        {
          name: 'default import + bare createHash call',
          code: "import crypto from 'node:crypto'\nconst h = createHash('sha256')\n",
          errors: [{ messageId: 'bareNamed', data: { name: 'createHash' } }],
          output:
            "import crypto from 'node:crypto'\nconst h = crypto.createHash('sha256')\n",
        },
        {
          name: 'default import + bare randomBytes call',
          code: "import crypto from 'node:crypto'\nconst b = randomBytes(16)\n",
          errors: [{ messageId: 'bareNamed', data: { name: 'randomBytes' } }],
          output:
            "import crypto from 'node:crypto'\nconst b = crypto.randomBytes(16)\n",
        },
      ],
    })
  })
})
