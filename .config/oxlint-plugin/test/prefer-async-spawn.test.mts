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
          name: 'async spawn import from lib',
          code: 'import { spawn } from "@socketsecurity/lib-stable/spawn"\nawait spawn("ls")\n',
        },
        {
          name: 'spawnSync import from lib (sync-aware)',
          code: 'import { spawnSync } from "@socketsecurity/lib-stable/spawn"\nspawnSync("ls")\n',
        },
        {
          name: 'bypass comment on import',
          code: '// prefer-async-spawn: sync-required\nimport { spawnSync } from "node:child_process"\nspawnSync("ls")\n',
        },
        {
          name: 'non-banned import from node:child_process is fine',
          code: 'import { exec } from "node:child_process"\n',
        },
      ],
      invalid: [
        {
          name: 'spawn import from node:child_process',
          code: 'import { spawn } from "node:child_process"\nawait spawn("ls")\n',
          errors: [{ messageId: 'importBanned' }],
        },
        {
          name: 'spawnSync import from node:child_process — source rewritten, name preserved',
          code: 'import { spawnSync } from "node:child_process"\nspawnSync("ls")\n',
          // The rule's autofix emits single quotes for the rewritten
          // import source; the call site retains its original quoting.
          output:
            'import { spawnSync } from \'@socketsecurity/lib-stable/spawn\'\nspawnSync("ls")\n',
          errors: [{ messageId: 'importBanned' }],
        },
        {
          name: 'child_process.spawnSync call — flagged, no autofix',
          // Namespace imports (`import * as child_process`) are not
          // flagged on the import line — only the call site is. The
          // rule's autofix can't safely rewrite a namespace usage,
          // so the report focuses on the call.
          code: 'import * as child_process from "node:child_process"\nchild_process.spawnSync("ls")\n',
          errors: [{ messageId: 'callBanned' }],
        },
        {
          name: 'mixed import (spawn + exec) — flagged but NOT autofixed',
          code: 'import { spawn, exec } from "node:child_process"\nspawn("ls")\nexec("ls")\n',
          errors: [{ messageId: 'importBanned' }],
        },
      ],
    })
  })
})
