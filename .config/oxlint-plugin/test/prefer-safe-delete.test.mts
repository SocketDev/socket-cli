/**
 * @fileoverview Unit tests for socket/prefer-safe-delete.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-safe-delete.mts'

describe('socket/prefer-safe-delete', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-safe-delete', rule, {
      valid: [
        {
          name: 'safeDelete from lib',
          code: 'import { safeDelete } from "@socketsecurity/lib-stable/fs"\nawait safeDelete("/x")\n',
        },
      ],
      invalid: [
        {
          name: 'fs.rm',
          code: 'import { promises as fs } from "node:fs"\nawait fs.rm("/x", { recursive: true })\n',
          errors: [{ messageId: 'banned' }],
        },
        {
          name: 'fs.unlink',
          code: 'import { unlinkSync } from "node:fs"\nunlinkSync("/x")\n',
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
