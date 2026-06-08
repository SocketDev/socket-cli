/**
 * @file Unit tests for socket/no-process-chdir. The rule bans `process.chdir()`
 *   everywhere EXCEPT test files (which chdir intentionally). Test cases use
 *   the `filename:` override to place fixtures at the right virtual path.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-process-chdir.mts'

describe('socket/no-process-chdir', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-process-chdir', rule, {
      valid: [
        {
          name: 'passing an explicit cwd option instead of chdir',
          filename: 'src/foo.mts',
          code: 'await spawn("ls", [], { cwd: dir })\n',
        },
        {
          name: 'process.cwd() read is a different rule, not banned here',
          filename: 'src/foo.mts',
          code: 'const x = process.cwd()\nconsole.log(x)\n',
        },
        {
          name: 'process.chdir inside test/ (exempt)',
          filename: 'test/foo.test.mts',
          code: 'process.chdir(tmp)\n',
        },
        {
          name: 'process.chdir in a *.test.* file (exempt)',
          filename: 'scripts/fleet/foo.test.mts',
          code: 'process.chdir(tmp)\n',
        },
        {
          name: 'an unrelated chdir method on another object',
          filename: 'src/foo.mts',
          code: 'shell.chdir("/tmp")\n',
        },
      ],
      invalid: [
        {
          name: 'process.chdir in src/',
          filename: 'src/foo.mts',
          code: 'process.chdir("/tmp")\n',
          errors: [{ messageId: 'processChdir' }],
        },
        {
          name: 'process.chdir in scripts/',
          filename: 'scripts/foo.mts',
          code: 'process.chdir(dir)\n',
          errors: [{ messageId: 'processChdir' }],
        },
        {
          name: 'process.chdir in a .claude/hooks/ file',
          filename: '.claude/hooks/foo/index.mts',
          code: 'process.chdir(dir)\n',
          errors: [{ messageId: 'processChdir' }],
        },
      ],
    })
  })
})
