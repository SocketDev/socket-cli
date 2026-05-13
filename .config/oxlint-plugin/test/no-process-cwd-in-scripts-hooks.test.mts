/**
 * @fileoverview Unit tests for socket/no-process-cwd-in-scripts-hooks.
 *
 * The rule only applies to files under `scripts/` or `.claude/hooks/`.
 * Test cases use the `filename:` override to place fixtures at the
 * right virtual path so the rule's path-matching logic fires.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-process-cwd-in-scripts-hooks.mts'

describe('socket/no-process-cwd-in-scripts-hooks', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-process-cwd-in-scripts-hooks', rule, {
      valid: [
        {
          name: 'import.meta.url anchor in scripts',
          filename: 'scripts/foo.mts',
          code: 'import { fileURLToPath } from "node:url"\nconst here = fileURLToPath(import.meta.url)\nconsole.log(here)\n',
        },
        {
          name: 'process.cwd OUTSIDE scripts/.claude/hooks',
          filename: 'src/foo.ts',
          code: 'const x = process.cwd()\nconsole.log(x)\n',
        },
        {
          name: 'process.cwd inside test/ (exempt)',
          filename: 'scripts/test/foo.test.mts',
          code: 'const x = process.cwd()\nconsole.log(x)\n',
        },
      ],
      invalid: [
        {
          name: 'process.cwd in scripts/',
          filename: 'scripts/foo.mts',
          code: 'const x = process.cwd()\nconsole.log(x)\n',
          errors: [{ messageId: 'processCwd' }],
        },
        {
          name: 'process.cwd in .claude/hooks/',
          filename: '.claude/hooks/foo/index.mts',
          code: 'const x = process.cwd()\nconsole.log(x)\n',
          errors: [{ messageId: 'processCwd' }],
        },
      ],
    })
  })
})
