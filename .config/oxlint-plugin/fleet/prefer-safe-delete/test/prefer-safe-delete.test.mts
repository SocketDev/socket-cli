/**
 * @file Unit tests for socket/prefer-safe-delete.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

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
          name: 'fs.unlinkSync member call',
          // The rule flags member calls on the fs object — the
          // canonical shape the codebase uses. Cherry-picked bare
          // imports of unlink/rm are normalized elsewhere.
          code: 'import fs from "node:fs"\nfs.unlinkSync("/x")\n',
          errors: [{ messageId: 'banned' }],
        },
      ],
    })
  })
})
