/**
 * @file Unit tests for socket/no-which-for-local-bin.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

describe('socket/no-which-for-local-bin', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-which-for-local-bin', rule, {
      valid: [
        {
          name: 'whichSync from lib-stable scoped to a bin dir',
          code:
            "import { whichSync } from '@socketsecurity/lib-stable/bin/which'\n" +
            "const bin = whichSync('oxlint', { path: binDir, nothrow: true })\n",
        },
        {
          name: 'unrelated string containing the word which',
          code: "const msg = 'which file do you want?'\n",
        },
        {
          name: 'bare which literal (argv[0] form) is not flagged — too ambiguous',
          code: "const label = 'which'\n",
        },
        {
          name: 'multi-word string starting with which is prose, not a lookup',
          code: "const q = 'which oxlint version is installed?'\n",
        },
        {
          name: 'explicit bypass marker for a legit global lookup',
          code:
            '// socket-lint: allow which-lookup\n' +
            "const git = execSync('which git')\n",
        },
      ],
      invalid: [
        {
          name: 'execSync shell string with which',
          code: "const p = execSync('which oxlint').toString()\n",
          errors: [{ messageId: 'whichLookup' }],
        },
        {
          name: 'command -v shell string',
          code: "const p = execSync('command -v pnpm')\n",
          errors: [{ messageId: 'whichLookup' }],
        },
        {
          name: 'where shell string (Windows)',
          code: "const p = execSync('where node')\n",
          errors: [{ messageId: 'whichLookup' }],
        },
      ],
    })
  })
})
