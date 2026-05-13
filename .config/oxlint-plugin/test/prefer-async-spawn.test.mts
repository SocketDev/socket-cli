/**
 * @fileoverview Unit tests for socket/prefer-async-spawn.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-async-spawn.mts'

describe('socket/prefer-async-spawn', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-async-spawn', rule, {
      valid: [
        {
          name: 'async spawn import',
          code: 'import { spawn } from "@socketsecurity/lib/spawn"\nawait spawn("ls")\n',
        },
        {
          name: 'sync spawnSync (allowed for sync-only contexts)',
          code: 'import { spawnSync } from "node:child_process"\nspawnSync("ls")\n',
        },
      ],
      invalid: [
        {
          name: 'node:child_process spawn import',
          code: 'import { spawn } from "node:child_process"\nspawn("ls")\n',
          errors: [{ messageId: 'importBanned' }, { messageId: 'callBanned' }],
        },
      ],
    })
  })
})
