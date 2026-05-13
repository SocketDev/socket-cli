/**
 * @fileoverview Unit tests for socket/optional-explicit-undefined.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/optional-explicit-undefined.mts'

describe('socket/optional-explicit-undefined', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('optional-explicit-undefined', rule, {
      valid: [
        {
          name: 'explicit | undefined',
          code: 'export interface X { foo?: string | undefined }\n',
        },
        {
          name: 'non-optional property',
          code: 'export interface X { foo: string }\n',
        },
        {
          name: 'union including undefined',
          code: 'export interface X { foo?: string | number | undefined }\n',
        },
      ],
      invalid: [
        {
          name: 'bare optional',
          code: 'export interface X { foo?: string }\n',
          errors: [{ messageId: 'missingUndefined' }],
        },
        {
          name: 'class field bare optional',
          code: 'export class X { foo?: string\n  constructor() { this.foo = undefined }\n}\n',
          errors: [{ messageId: 'missingUndefined' }],
        },
      ],
    })
  })
})
