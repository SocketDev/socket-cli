/**
 * @file Unit tests for socket/prefer-mock-import.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/prefer-mock-import', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-mock-import', rule, {
      valid: [
        {
          name: 'already uses import() form',
          code: "vi.mock(import('./services/user'))\n",
        },
        {
          name: 'vitest.mock with import()',
          code: "vitest.mock(import('./a'))\n",
        },
        {
          name: 'non-mock vi method left alone',
          code: "vi.fn('./a')\n",
        },
        {
          name: 'unrelated object.mock left alone',
          code: "jest.mock('./a')\n",
        },
        {
          name: 'template-literal arg left alone',
          code: 'vi.mock(`./${name}`)\n',
        },
      ],
      invalid: [
        {
          name: 'vi.mock string literal → import()',
          code: "vi.mock('./services/user')\n",
          errors: [{ messageId: 'preferImport' }],
          output: "vi.mock(import('./services/user'))\n",
        },
        {
          name: 'vi.doMock double-quoted string',
          code: 'vi.doMock("./a")\n',
          errors: [{ messageId: 'preferImport' }],
          output: 'vi.doMock(import("./a"))\n',
        },
        {
          name: 'vitest.unmock string literal',
          code: "vitest.unmock('./b')\n",
          errors: [{ messageId: 'preferImport' }],
          output: "vitest.unmock(import('./b'))\n",
        },
      ],
    })
  })
})
