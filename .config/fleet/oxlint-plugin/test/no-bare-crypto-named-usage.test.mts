/**
 * @file Unit tests for socket/no-bare-crypto-named-usage.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-bare-crypto-named-usage.mts'

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
