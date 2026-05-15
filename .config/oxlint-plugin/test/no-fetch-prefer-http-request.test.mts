/**
 * @fileoverview Unit tests for socket/no-fetch-prefer-http-request.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-fetch-prefer-http-request.mts'

describe('socket/no-fetch-prefer-http-request', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-fetch-prefer-http-request', rule, {
      valid: [
        {
          name: 'httpJson import',
          code: 'import { httpJson } from "@socketsecurity/lib-stable/http-request"\nawait httpJson("https://x")\n',
        },
        { name: 'no fetch call', code: 'const x = 1\n' },
      ],
      invalid: [
        {
          name: 'top-level fetch',
          code: 'await fetch("https://x")\n',
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
