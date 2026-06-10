/**
 * @file Unit tests for socket/no-structured-clone-prefer-json.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/no-structured-clone-prefer-json', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-structured-clone-prefer-json', rule, {
      valid: [
        {
          name: 'json roundtrip clone — preferred shape',
          code: 'export const r = (v: unknown) => JSON.parse(JSON.stringify(v))\n',
        },
        {
          name: 'member-call structuredClone (user method, unrelated)',
          code: 'export const r = (o: { structuredClone(): unknown }) => o.structuredClone()\n',
        },
      ],
      invalid: [
        {
          name: 'bare structuredClone call flagged',
          code: 'export const r = (v: unknown) => structuredClone(v)\n',
          errors: [{ messageId: 'noStructuredClone' }],
        },
      ],
    })
  })
})
