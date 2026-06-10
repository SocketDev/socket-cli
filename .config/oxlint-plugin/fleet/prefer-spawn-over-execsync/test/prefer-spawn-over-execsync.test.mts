/**
 * @file Unit tests for the prefer-spawn-over-execsync oxlint rule. Spawns the
 *   real oxlint binary against fixture files in a tmp dir (see
 *   lib/rule-tester.mts). Skips silently when `oxlint` isn't on PATH so a
 *   fresh-laptop checkout doesn't false-fail before `pnpm install` materializes
 *   the bin link.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/prefer-spawn-over-execsync', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-spawn-over-execsync', rule, {
      valid: [
        {
          name: 'lib-stable spawn import',
          code: "import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'\n",
        },
        {
          name: 'lib-stable spawnSync import',
          code: "import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'\n",
        },
        {
          name: 'node:child_process spawn (not exec*Sync) is acceptable',
          // This rule is specifically about exec*Sync. The
          // companion `prefer-async-spawn` rule handles plain
          // `spawn` from node:child_process.
          code: "import { spawn } from 'node:child_process'\n",
        },
      ],
      invalid: [
        {
          name: 'execSync from node:child_process',
          code: "import { execSync } from 'node:child_process'\n",
          errors: [{ messageId: 'preferSpawn' }],
        },
        {
          name: 'execFileSync from node:child_process',
          code: "import { execFileSync } from 'node:child_process'\n",
          errors: [{ messageId: 'preferSpawn' }],
        },
        {
          name: 'mixed execSync + execFileSync',
          code: "import { execSync, execFileSync } from 'node:child_process'\n",
          errors: [{ messageId: 'preferSpawn' }, { messageId: 'preferSpawn' }],
        },
      ],
    })
  })
})
